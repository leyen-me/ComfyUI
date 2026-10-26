"""任务队列接口：合并 Filmline 持久化任务与 ComfyUI 当前队列。"""

from __future__ import annotations

import asyncio
from dataclasses import asdict
from typing import Any

from aiohttp import web

from .. import generation, progress
from ..domain.tasks import ACTIVE_STATUSES, TaskOut, TaskService
from ..errors import InvalidArgument
from ..runner import RUNNER_KEY
from .http import handle_errors, ok, parse_int

API_PREFIX = "/studio/api"


def _graph_kind(graph: dict[str, Any]) -> str:
    types = {
        str(node.get("class_type") or "")
        for node in graph.values()
        if isinstance(node, dict)
    }
    if types & {"SaveVideo", "CreateVideo"} or any("MiniMaxH3" in item for item in types):
        return "video"
    if "SaveImage" in types or any("QwenImage" in item for item in types):
        return "image"
    return "unknown"


def _graph_prompt(graph: dict[str, Any]) -> str:
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        prompt = (node.get("inputs") or {}).get("prompt")
        if isinstance(prompt, str) and prompt.strip():
            return prompt.strip()[:160]
    return ""


def _task_payload(task: TaskOut, position: int | None) -> dict[str, Any]:
    data = asdict(task)
    data["queue_position"] = position
    data["external"] = False
    data["progress"] = (
        progress.snapshot(task.id) if task.status in ACTIVE_STATUSES else None
    )
    return data


def _external_payload(
    entry: generation.QueuedPrompt, *, status: str, position: int | None
) -> dict[str, Any]:
    return {
        "id": None,
        "client_id": str((entry.extra_data or {}).get("client_id") or ""),
        "prompt_id": entry.prompt_id,
        "project_id": None,
        "project_code": None,
        "project_name": "ComfyUI 外部任务",
        "episode_id": None,
        "episode_code": None,
        "kind": _graph_kind(entry.graph),
        "status": status,
        "prompt_excerpt": _graph_prompt(entry.graph),
        "client_label": "",
        "created_at": None,
        "started_at": None,
        "finished_at": None,
        "elapsed_ms": None,
        "error": None,
        "asset_ids": [],
        "queue_position": position,
        "external": True,
        "progress": None,
    }


def register_task_routes(routes: web.RouteTableDef) -> None:
    service = TaskService()

    @routes.get(f"{API_PREFIX}/tasks")
    @handle_errors
    async def list_tasks(request: web.Request) -> web.Response:
        limit = parse_int(request, "limit", default=30, minimum=1, maximum=100)
        active_only = request.query.get("active") in ("1", "true", "yes")
        tasks = await asyncio.to_thread(service.list, limit=limit, active_only=active_only)
        running, pending = await generation.queue_snapshot()
        positions = {entry.prompt_id: 0 for entry in running}
        positions.update(
            {entry.prompt_id: index + 1 for index, entry in enumerate(pending)}
        )

        items = [_task_payload(task, positions.get(task.prompt_id or "")) for task in tasks]
        known_prompt_ids = await asyncio.to_thread(service.active_prompt_ids)

        for entry in running:
            if entry.prompt_id not in known_prompt_ids:
                items.append(
                    _external_payload(entry, status="running", position=0)
                )
        for index, entry in enumerate(pending):
            if entry.prompt_id not in known_prompt_ids:
                items.append(
                    _external_payload(entry, status="queued", position=index + 1)
                )

        # 进行中按进入顺序，已完成按最近优先
        active_items = [item for item in items if item["status"] in ACTIVE_STATUSES]
        finished_items = [item for item in items if item["status"] not in ACTIVE_STATUSES]
        active_items.sort(key=lambda item: item.get("created_at") or "")
        finished_items.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        ordered = active_items + finished_items
        active = len(active_items)
        return ok({"items": ordered[:limit], "active": active})

    @routes.get(f"{API_PREFIX}/tasks/{{task_id}}")
    @handle_errors
    async def get_task(request: web.Request) -> web.Response:
        try:
            task_id = int(request.match_info["task_id"])
        except ValueError as exc:
            raise InvalidArgument("task_id 必须是整数") from exc
        task = await asyncio.to_thread(service.get, task_id)
        running, pending = await generation.queue_snapshot()
        position = 0 if any(entry.prompt_id == task.prompt_id for entry in running) else None
        if position is None:
            for index, entry in enumerate(pending):
                if entry.prompt_id == task.prompt_id:
                    position = index + 1
                    break
        return ok(_task_payload(task, position))

    @routes.post(f"{API_PREFIX}/tasks/{{task_id}}/cancel")
    @handle_errors
    async def cancel_task(request: web.Request) -> web.Response:
        try:
            task_id = int(request.match_info["task_id"])
        except ValueError as exc:
            raise InvalidArgument("task_id 必须是整数") from exc

        task = await asyncio.to_thread(service.get, task_id)
        if task.status not in ACTIVE_STATUSES:
            return ok(_task_payload(task, None))

        # 先落库为 cancelled，runner 在提交前后都会检查终态，避免竞态
        await asyncio.to_thread(service.mark_cancelled, task_id)
        updated = await asyncio.to_thread(service.get, task_id)

        if updated.prompt_id:
            await generation.cancel(updated.prompt_id)
            runner = request.app.get(RUNNER_KEY)
            if runner is not None:
                runner.cancel_local(task_id)
        # 没有 prompt_id 时不取消本地协程：runner 会在提交前/后检查状态，
        # 若已提交则自己调用 generation.cancel，避免丢下孤儿任务。

        return ok(_task_payload(updated, None))

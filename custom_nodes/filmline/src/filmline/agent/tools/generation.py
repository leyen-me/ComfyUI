"""生成与任务工具：提交图片/视频、查询、等待、取消。"""

from __future__ import annotations

import asyncio
from dataclasses import asdict

from ... import generation, progress
from ...domain.produce import submit_generation
from ...domain.projects import ProjectService
from ...domain.tasks import ACTIVE_STATUSES, TaskService
from ...errors import InvalidArgument, NotFound
from .base import Tool, ToolContext, ToolOutcome, register

WAIT_DEFAULT = 120
WAIT_MAX = 900


def _task_brief(task) -> dict:
    data = asdict(task)
    return {
        "task_id": data["id"],
        "kind": data["kind"],
        "status": data["status"],
        "project": data["project_code"],
        "episode": data["episode_code"],
        "prompt_excerpt": data["prompt_excerpt"],
        "asset_ids": data["asset_ids"],
        "error": data["error"],
        "started_at": data["started_at"],
        "finished_at": data["finished_at"],
    }


async def _submit(ctx: ToolContext, payload: dict, label: str) -> ToolOutcome:
    project = await asyncio.to_thread(ProjectService().get, ctx.project_code)
    task = await submit_generation(
        project,
        episode_code=payload.pop("episode", None),
        payload=payload,
        runner=ctx.runner,
        client_label=label,
    )
    if ctx.watch_task is not None:
        ctx.watch_task(task.id)
    if ctx.emit is not None:
        await ctx.emit(
            "asset.watch",
            {"task_id": task.id, "kind": task.kind, "status": task.status},
        )
    return ToolOutcome(
        summary=(
            f"已提交{('图片' if task.kind == 'image' else '视频')}任务 #{task.id}，"
            "正在排队/生成；可稍后用 wait_generation 查询，完成后会自动通知"
        ),
        data=_task_brief(task),
        meta={"task_id": task.id, "async": True},
    )


async def _create_image(ctx: ToolContext, args: dict) -> ToolOutcome:
    payload = {
        "kind": "image",
        "prompt": args["prompt"],
        "refs": args.get("refs") or [],
        "size": args.get("size", "1:1"),
        "resolution": args.get("resolution", "1k"),
        "count": args.get("count", 1),
        "episode": args.get("episode"),
    }
    if args.get("seed") is not None:
        payload["seed"] = args["seed"]
    return await _submit(ctx, payload, "Agent 图片")


async def _create_video(ctx: ToolContext, args: dict) -> ToolOutcome:
    payload: dict = {
        "kind": "video",
        "prompt": args["prompt"],
        "mode": args.get("mode", "keyframes"),
        "size": args.get("size", "16:9"),
        "resolution": args.get("resolution", "768"),
        "duration": args.get("duration", 5),
        "episode": args.get("episode"),
    }
    for key in (
        "first_frame_id",
        "last_frame_id",
        "refs",
        "ref_videos",
        "ref_audios",
        "ref_guides",
        "ref_quality",
        "ref_scheduler",
        "ref_image_size",
        "auto_duration",
        "seed",
    ):
        if args.get(key) is not None:
            payload[key] = args[key]
    return await _submit(ctx, payload, "Agent 视频")


async def _get_task(ctx: ToolContext, args: dict) -> ToolOutcome:
    task = await asyncio.to_thread(TaskService().get, args["task_id"])
    if task.project_id != ctx.project_id:
        raise NotFound("任务不属于当前项目")
    data = _task_brief(task)
    data["progress"] = progress.snapshot(task.id)
    return ToolOutcome(
        summary=f"任务 #{task.id} {task.status}"
        + (f"（{task.error}）" if task.error else ""),
        data=data,
    )


async def _list_tasks(ctx: ToolContext, args: dict) -> ToolOutcome:
    tasks = await asyncio.to_thread(
        TaskService().list,
        limit=args.get("limit", 20),
        active_only=bool(args.get("active_only")),
    )
    items = [_task_brief(task) for task in tasks if task.project_id == ctx.project_id]
    return ToolOutcome(summary=f"当前项目 {len(items)} 个任务", data={"items": items})


async def _wait(ctx: ToolContext, args: dict) -> ToolOutcome:
    task_ids = list(dict.fromkeys(args["task_ids"]))
    timeout = min(WAIT_MAX, max(5, int(args.get("timeout_seconds", WAIT_DEFAULT))))
    elapsed = 0
    last: dict[int, str] = {}
    while True:
        tasks = []
        for task_id in task_ids:
            task = await asyncio.to_thread(TaskService().get, task_id)
            if task.project_id != ctx.project_id:
                raise NotFound(f"任务不属于当前项目: {task_id}")
            tasks.append(task)

        for task in tasks:
            snapshot = progress.snapshot(task.id)
            stage = (snapshot or {}).get("stage") or task.status
            percent = (snapshot or {}).get("percent")
            text = f"#{task.id} {stage}"
            if last.get(task.id) != f"{text}:{percent}":
                last[task.id] = f"{text}:{percent}"
                await ctx.notify(text, percent)

        if all(task.status not in ACTIVE_STATUSES for task in tasks):
            succeeded = [task for task in tasks if task.status == "succeeded"]
            failed = [task for task in tasks if task.status != "succeeded"]
            return ToolOutcome(
                ok=not failed,
                summary=(
                    f"任务完成：{len(succeeded)} 个成功"
                    + (f"，{len(failed)} 个失败/取消" if failed else "")
                ),
                data={
                    "tasks": [
                        {
                            **_task_brief(task),
                            "progress": progress.snapshot(task.id),
                        }
                        for task in tasks
                    ]
                },
                error=None
                if not failed
                else {
                    "code": "generation_failed",
                    "message": "；".join(
                        f"#{task.id} {task.status}: {task.error or '无详情'}"
                        for task in failed
                    ),
                },
            )

        if elapsed >= timeout:
            return ToolOutcome(
                summary=f"等待 {timeout} 秒仍未完成，任务继续在后台运行；完成后会通知",
                data={"tasks": [_task_brief(task) for task in tasks], "timed_out": True},
                meta={"timed_out": True},
            )

        await asyncio.sleep(2)
        elapsed += 2


async def _cancel(ctx: ToolContext, args: dict) -> ToolOutcome:
    if not args.get("confirmed"):
        return ToolOutcome(
            ok=False,
            summary="取消任务需要用户确认",
            error={
                "code": "confirmation_required",
                "message": "请先调用 ask_question 让用户确认，再带 confirmed=true 重试",
            },
        )
    task = await asyncio.to_thread(TaskService().get, args["task_id"])
    if task.project_id != ctx.project_id:
        raise NotFound("任务不属于当前项目")
    if task.status not in ACTIVE_STATUSES:
        return ToolOutcome(
            ok=False,
            summary=f"任务 #{task.id} 已经结束（{task.status}）",
            error={"code": "not_active", "message": "任务不在运行中"},
            data=_task_brief(task),
        )
    service = TaskService()
    await asyncio.to_thread(service.mark_cancelled, task.id)
    updated = await asyncio.to_thread(service.get, task.id)
    if updated.prompt_id:
        await generation.cancel(updated.prompt_id)
        if ctx.runner is not None:
            ctx.runner.cancel_local(task.id)
    return ToolOutcome(summary=f"已取消任务 #{task.id}", data=_task_brief(updated))


EPISODE = {"type": "string", "maxLength": 16}
RATIO = {"type": "string", "enum": ["16:9", "9:16", "1:1"]}


def register_tools() -> None:
    register(
        Tool(
            name="create_image",
            label="生成图片",
            description=(
                "提交图片生成任务（异步）。提示词写画面主体、构图、光线、风格；"
                "refs 是项目内图片资产 id，最多 10 张，作为参考图。完成后自动通知。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "minLength": 1, "maxLength": 8000},
                    "refs": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "maxItems": 10,
                    },
                    "size": RATIO,
                    "resolution": {"type": "string", "enum": ["1k", "2k"]},
                    "count": {"type": "integer", "minimum": 1, "maximum": 4},
                    "seed": {"type": "integer", "minimum": 0, "maximum": 2147483647},
                    "episode": EPISODE,
                },
                "required": ["prompt"],
                "additionalProperties": False,
            },
            handler=_create_image,
            write=True,
        )
    )
    register(
        Tool(
            name="create_video",
            label="生成视频",
            description=(
                "提交视频生成任务（异步，可能数分钟）。mode=keyframes 用首尾帧锁构图，"
                "mode=reference 用参考图/视频/音频；Reference 模式必须有 refs 或 ref_videos。"
                "duration 为 5–15 秒，resolution 为 768（原生）或 0.4（草稿）。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string", "minLength": 1, "maxLength": 12000},
                    "mode": {"type": "string", "enum": ["keyframes", "reference"]},
                    "first_frame_id": {"type": "integer", "minimum": 1},
                    "last_frame_id": {"type": "integer", "minimum": 1},
                    "refs": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "maxItems": 9,
                    },
                    "ref_videos": {
                        "type": "array",
                        "maxItems": 3,
                        "items": {
                            "type": "object",
                            "properties": {
                                "asset_id": {"type": "integer", "minimum": 1},
                                "use_audio": {"type": "boolean"},
                                "trim_start": {"type": "number", "minimum": 0, "maximum": 15},
                                "trim_end": {"type": "number", "minimum": 0, "maximum": 15},
                            },
                            "required": ["asset_id"],
                            "additionalProperties": False,
                        },
                    },
                    "ref_audios": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "maxItems": 3,
                    },
                    "ref_guides": {
                        "type": "array",
                        "maxItems": 4,
                        "items": {
                            "type": "object",
                            "properties": {
                                "asset_id": {"type": "integer", "minimum": 1},
                                "at_seconds": {"type": "number", "minimum": 0, "maximum": 15},
                            },
                            "required": ["asset_id"],
                            "additionalProperties": False,
                        },
                    },
                    "duration": {"type": "number", "minimum": 5, "maximum": 15},
                    "size": RATIO,
                    "resolution": {"type": "string", "enum": ["768", "0.4"]},
                    "ref_quality": {"type": "string", "enum": ["quality", "fast"]},
                    "ref_scheduler": {"type": "string", "enum": ["simple", "beta", "normal"]},
                    "ref_image_size": {"type": "string", "enum": ["match", "max"]},
                    "auto_duration": {"type": "boolean"},
                    "seed": {"type": "integer", "minimum": 0, "maximum": 2147483647},
                    "episode": EPISODE,
                },
                "required": ["prompt"],
                "additionalProperties": False,
            },
            handler=_create_video,
            write=True,
        )
    )
    register(
        Tool(
            name="get_generation_task",
            label="查询任务",
            description="查询单个生成任务的状态、进度与产物资产 id。",
            parameters={
                "type": "object",
                "properties": {"task_id": {"type": "integer", "minimum": 1}},
                "required": ["task_id"],
                "additionalProperties": False,
            },
            handler=_get_task,
        )
    )
    register(
        Tool(
            name="list_generation_tasks",
            label="列出任务",
            description="列出当前项目的生成任务。",
            parameters={
                "type": "object",
                "properties": {
                    "active_only": {"type": "boolean"},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20},
                },
                "additionalProperties": False,
            },
            handler=_list_tasks,
        )
    )
    register(
        Tool(
            name="wait_generation",
            label="等待生成",
            description=(
                "等待一个或多个任务结束，期间持续推送进度，最长 900 秒。"
                "超时不会取消任务；稍后可用 get_generation_task 再查，完成也会自动通知。"
                "不需要连续等待时可以完全不调用本工具。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "task_ids": {
                        "type": "array",
                        "items": {"type": "integer", "minimum": 1},
                        "minItems": 1,
                        "maxItems": 8,
                    },
                    "timeout_seconds": {
                        "type": "integer",
                        "minimum": 5,
                        "maximum": WAIT_MAX,
                        "default": WAIT_DEFAULT,
                    },
                },
                "required": ["task_ids"],
                "additionalProperties": False,
            },
            handler=_wait,
        )
    )
    register(
        Tool(
            name="cancel_generation_task",
            label="取消生成",
            description="取消排队或运行中的生成任务。属于破坏性操作，先确认用户意图。",
            parameters={
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "minimum": 1},
                    "confirmed": {"type": "boolean"},
                },
                "required": ["task_id"],
                "additionalProperties": False,
            },
            handler=_cancel,
            write=True,
            destructive=True,
        )
    )

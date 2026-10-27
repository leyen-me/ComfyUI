"""Agent HTTP 接口：会话列表、消息、暂停、问答与 SSE 事件流。"""

from __future__ import annotations

import asyncio
import json

from aiohttp import web

from .. import config
from ..agent import store
from ..agent.bus import BUS
from ..agent.engine import ENGINE_KEY, AgentEngine
from ..domain.assets import AssetService
from ..domain.projects import ProjectService
from ..errors import Conflict, InvalidArgument, NotFound
from .http import handle_errors, ok, parse_int, read_object

API_PREFIX = "/studio/api"
MAX_TEXT = 100_000
MAX_ASSETS = 12


def _engine(request: web.Request) -> AgentEngine:
    engine = request.app.get(ENGINE_KEY)
    if engine is None:
        raise InvalidArgument("Agent 引擎未初始化")
    return engine


async def _session(session_id: int) -> store.SessionInfo:
    return await asyncio.to_thread(store.get_session, session_id)


async def _session_id(request: web.Request) -> int:
    try:
        return int(request.match_info["session_id"])
    except (KeyError, ValueError) as exc:
        raise InvalidArgument("session_id 必须是整数") from exc


def _session_out(info: store.SessionInfo) -> dict:
    return {
        "id": info.id,
        "project_id": info.project_id,
        "title": info.title,
        "status": info.status,
        "model": info.model,
        "context_window": info.context_window,
        "usage": info.usage,
        "turn": info.turn,
        "last_seq": info.last_seq,
        "created_at": info.created_at,
        "updated_at": info.updated_at,
    }


def _assets_block(items: list) -> str:
    lines = ["[附件]"]
    for item in items:
        lines.append(f"- #{item.id} {item.kind.value} 「{item.name}」")
    return "\n".join(lines)


async def _load_assets(project_id: int, raw: object) -> list:
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(
        isinstance(value, int) and not isinstance(value, bool) and value > 0 for value in raw
    ):
        raise InvalidArgument("asset_ids 必须是资产 id 数组")
    unique = list(dict.fromkeys(raw))
    if len(unique) > MAX_ASSETS:
        raise InvalidArgument(f"单条消息最多附带 {MAX_ASSETS} 个资产")
    if not unique:
        return []
    assets = AssetService()
    items = []
    for asset_id in unique:
        item = await asyncio.to_thread(assets.get, asset_id)
        if item.project_id != project_id:
            raise InvalidArgument("附件资产不属于当前项目")
        items.append(item)
    return items


def register_agent_routes(routes: web.RouteTableDef) -> None:
    settings = config.agent_settings()

    @routes.get(f"{API_PREFIX}/projects/{{ref}}/agent/sessions")
    @handle_errors
    async def list_sessions(request: web.Request) -> web.Response:
        project = await asyncio.to_thread(ProjectService().get, request.match_info["ref"])
        items = await asyncio.to_thread(store.list_sessions, project.id)
        return ok(
            {
                "items": [_session_out(item) for item in items],
                "model": settings.model,
                "context_window": settings.context_window,
                "configured": settings.configured,
            }
        )

    @routes.post(f"{API_PREFIX}/projects/{{ref}}/agent/sessions")
    @handle_errors
    async def create_session(request: web.Request) -> web.Response:
        project = await asyncio.to_thread(ProjectService().get, request.match_info["ref"])
        payload: dict = {}
        if request.can_read_body:
            try:
                payload = await read_object(request)
            except InvalidArgument:
                payload = {}
        title = str(payload.get("title") or "新对话").strip()[:200] or "新对话"
        info = await asyncio.to_thread(
            store.create_session,
            project.id,
            title=title,
            model=settings.model,
            context_window=settings.context_window,
        )
        return ok(_session_out(info), status=201)

    @routes.get(f"{API_PREFIX}/agent/sessions/{{session_id}}")
    @handle_errors
    async def get_session(request: web.Request) -> web.Response:
        info = await _session(await _session_id(request))
        return ok(_session_out(info))

    @routes.patch(f"{API_PREFIX}/agent/sessions/{{session_id}}")
    @handle_errors
    async def patch_session(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        payload = await read_object(request)
        title = str(payload.get("title") or "").strip()
        if not title:
            raise InvalidArgument("标题不能为空")
        await asyncio.to_thread(store.update_session, session_id, title=title[:200])
        return ok(_session_out(await _session(session_id)))

    @routes.delete(f"{API_PREFIX}/agent/sessions/{{session_id}}")
    @handle_errors
    async def delete_session(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        info = await _session(session_id)
        if info.running:
            await _engine(request).pause_session(session_id)
        await asyncio.to_thread(store.delete_session, session_id)
        return web.Response(status=204)

    @routes.post(f"{API_PREFIX}/agent/sessions/{{session_id}}/messages")
    @handle_errors
    async def post_message(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        info = await _session(session_id)
        if info.status in ("running", "waiting_input"):
            raise Conflict("Agent 正在运行，请先暂停或等待完成")

        payload = await read_object(request)
        text = str(payload.get("text") or "")
        if len(text) > MAX_TEXT:
            raise InvalidArgument(f"单条消息最多 {MAX_TEXT} 字符")
        assets = await _load_assets(info.project_id, payload.get("asset_ids"))
        if not text.strip() and not assets:
            raise InvalidArgument("消息不能为空")

        content = text.rstrip()
        if assets:
            block = _assets_block(assets)
            content = f"{content}\n\n{block}" if content else block
        descriptor = [
            {"id": item.id, "kind": item.kind.value, "name": item.name} for item in assets
        ]

        turn = info.turn + 1
        await asyncio.to_thread(store.update_session, session_id, turn=turn)
        message_seq = await asyncio.to_thread(
            store.append_message,
            session_id,
            turn=turn,
            role="user",
            content=content,
            meta={"assets": descriptor} if descriptor else None,
        )
        if info.title in ("新对话", "") and text.strip():
            title = text.strip().splitlines()[0][:40]
            await asyncio.to_thread(store.update_session, session_id, title=title)

        event = await asyncio.to_thread(
            store.append_event,
            session_id,
            "user.message",
            {
                "turn": turn,
                "message_seq": message_seq,
                "text": text,
                "content": content,
                "assets": descriptor,
            },
        )
        BUS.publish(session_id, event)
        await _engine(request).start_session(session_id)
        return ok(
            {
                "session": _session_out(await _session(session_id)),
                "seq": event["seq"],
                "turn": turn,
            },
            status=202,
        )

    @routes.get(f"{API_PREFIX}/agent/sessions/{{session_id}}/events")
    async def events(request: web.Request) -> web.StreamResponse:
        try:
            session_id = await _session_id(request)
            await _session(session_id)
            after = parse_int(request, "after", default=0, minimum=0, maximum=2**31 - 1)
        except (InvalidArgument, NotFound) as exc:
            return web.json_response(
                {"ok": False, "error": {"code": exc.code, "message": exc.message}},
                status=exc.status,
            )
        response = web.StreamResponse(
            status=200,
            headers={
                "Content-Type": "text/event-stream; charset=utf-8",
                "Cache-Control": "no-cache, no-transform",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
        await response.prepare(request)
        queue = BUS.subscribe(session_id)
        last = after

        def frame(event: dict) -> bytes:
            body = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
            return f"id: {event['seq']}\ndata: {body}\n\n".encode("utf-8")

        try:
            while True:
                batch = await asyncio.to_thread(
                    store.list_events, session_id, after=last, limit=2000
                )
                if not batch:
                    break
                for event in batch:
                    await response.write(frame(event))
                    last = event["seq"]
                if len(batch) < 2000:
                    break

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15)
                except asyncio.TimeoutError:
                    await response.write(b": ping\n\n")
                    continue
                if event["seq"] <= last:
                    continue
                await response.write(frame(event))
                last = event["seq"]
        except (ConnectionResetError, asyncio.CancelledError, BrokenPipeError):
            pass
        finally:
            BUS.unsubscribe(session_id, queue)
        return response

    @routes.post(f"{API_PREFIX}/agent/sessions/{{session_id}}/pause")
    @handle_errors
    async def pause(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        active = await _engine(request).pause_session(session_id)
        return ok({"paused": active, "session": _session_out(await _session(session_id))})

    @routes.post(f"{API_PREFIX}/agent/sessions/{{session_id}}/resume")
    @handle_errors
    async def resume(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        info = await _session(session_id)
        if info.running:
            return ok({"resumed": False, "session": _session_out(info)})
        if info.status == "idle" and info.turn == 0:
            raise InvalidArgument("会话还没有消息")
        await _engine(request).start_session(session_id)
        return ok({"resumed": True, "session": _session_out(await _session(session_id))})

    @routes.post(f"{API_PREFIX}/agent/sessions/{{session_id}}/answers")
    @handle_errors
    async def answer(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        payload = await read_object(request)
        tool_call_id = str(payload.get("tool_call_id") or "")
        answers = payload.get("answers")
        if not tool_call_id:
            raise InvalidArgument("缺少 tool_call_id")
        if not isinstance(answers, dict):
            raise InvalidArgument("answers 必须是对象")
        accepted = await _engine(request).answer(session_id, tool_call_id, answers)
        if not accepted:
            raise Conflict("没有等待回答的问题（可能已经暂停或完成）")
        event = await asyncio.to_thread(
            store.append_event,
            session_id,
            "question.answered",
            {"tool_call_id": tool_call_id, "answers": answers},
        )
        BUS.publish(session_id, event)
        return ok({"accepted": True})

    @routes.post(f"{API_PREFIX}/agent/sessions/{{session_id}}/tools/{{tool_call_id}}/pause")
    @handle_errors
    async def pause_tool(request: web.Request) -> web.Response:
        session_id = await _session_id(request)
        tool_call_id = request.match_info["tool_call_id"]
        paused = await _engine(request).pause_tool(session_id, tool_call_id)
        if not paused:
            raise Conflict("该工具已不在运行")
        return ok({"paused": True})

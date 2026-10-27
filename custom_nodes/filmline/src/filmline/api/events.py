"""工作区实时事件：资产 / 分集 / 项目的变更通过 SSE 通知浏览器。

事件只用于刷新提示，不保证送达、不回放。断线重连后前端应做一次全量拉取。
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiohttp
from aiohttp import web

from .. import events
from ..domain.projects import ProjectService
from ..errors import AppError
from .http import fail

_LOG = logging.getLogger("filmline.events")

API_PREFIX = "/studio/api"
HEARTBEAT_SECONDS = 20


def _matches(event: dict[str, Any], project_id: int | None) -> bool:
    if project_id is None:
        return True
    return event.get("project_id") == project_id


def register_event_routes(routes: web.RouteTableDef) -> None:
    @routes.get(f"{API_PREFIX}/events")
    async def workspace_events(request: web.Request) -> web.StreamResponse:
        project_id: int | None = None
        ref = (request.query.get("project") or "").strip()
        if ref:
            try:
                project = await asyncio.to_thread(ProjectService().get, ref)
                project_id = project.id
            except AppError as exc:
                return fail(exc)

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
        queue = events.BUS.subscribe()
        try:
            # 让浏览器的自动重连间隔与后端保持一致
            await response.write(b"retry: 3000\n\n")
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_SECONDS)
                except asyncio.TimeoutError:
                    await response.write(b": ping\n\n")
                    continue
                if not _matches(event, project_id):
                    continue
                body = json.dumps(event, ensure_ascii=False, separators=(",", ":"))
                await response.write(f"data: {body}\n\n".encode("utf-8"))
        except (
            ConnectionResetError,
            BrokenPipeError,
            asyncio.CancelledError,
            aiohttp.ClientConnectionError,
        ):
            pass
        except Exception:
            # 响应头已经发出，只能记录日志并断开这条连接
            _LOG.exception("工作区事件流异常")
        finally:
            events.BUS.unsubscribe(queue)
        return response

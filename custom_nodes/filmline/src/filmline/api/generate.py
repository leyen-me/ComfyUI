"""生成接口：校验参数、创建持久化任务并交给后台 runner。

    POST /studio/api/projects/{ref}/generate?episode=EP01
    body: {kind, prompt, size, count?, duration?}

参数校验与 Agent 工具共用 ``domain.produce.submit_generation``，
避免两条入口各有一套规则。请求不等待生成完成，立即返回 202 + task。
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict

from aiohttp import web

from ..domain.produce import submit_generation
from ..domain.projects import ProjectService
from ..errors import InvalidArgument
from ..runner import RUNNER_KEY
from .http import handle_errors, ok, read_object


def register_generate_routes(routes: web.RouteTableDef) -> None:
    @routes.post("/studio/api/projects/{ref}/generate")
    @handle_errors
    async def generate(request: web.Request) -> web.Response:
        payload = await read_object(request)
        project = await asyncio.to_thread(ProjectService().get, request.match_info["ref"])
        runner = request.app.get(RUNNER_KEY)
        if runner is None:
            raise InvalidArgument("任务执行器未初始化")
        task = await submit_generation(
            project,
            episode_code=request.query.get("episode"),
            payload=payload,
            runner=runner,
        )
        return ok({"task": asdict(task)}, status=202)

"""项目接口。

路由（同源，供 /studio 前端调用）::

    GET    /studio/api/projects            列表（q / limit / offset）
    POST   /studio/api/projects            新建（name 必填，编号自动生成）
    PUT    /studio/api/projects/order      拖拽排序（ids 需覆盖全部项目）
    GET    /studio/api/projects/{ref}      详情（ref 可为 id 或编号）
    PATCH  /studio/api/projects/{ref}      更新 name / description
    DELETE /studio/api/projects/{ref}      软删除
"""

from __future__ import annotations

import asyncio

from aiohttp import web

from ..domain.projects import ProjectService
from ..domain.schemas import ProjectCreate, ProjectReorder, ProjectUpdate
from ..errors import InvalidArgument
from .http import handle_errors, ok, parse_int, read_object


def register_project_routes(routes: web.RouteTableDef) -> None:
    service = ProjectService()

    @routes.get("/studio/api/projects")
    @handle_errors
    async def list_projects(request: web.Request) -> web.Response:
        q = (request.query.get("q") or "").strip() or None
        if q is not None and len(q) > 100:
            raise InvalidArgument("q 最长 100 个字符")
        result = await asyncio.to_thread(
            service.list,
            q=q,
            limit=parse_int(request, "limit", default=50, minimum=1, maximum=200),
            offset=parse_int(request, "offset", default=0, minimum=0, maximum=10_000_000),
        )
        return ok(result.model_dump(mode="json"))

    @routes.post("/studio/api/projects")
    @handle_errors
    async def create_project(request: web.Request) -> web.Response:
        payload = ProjectCreate.model_validate(await read_object(request))
        project = await asyncio.to_thread(service.create, payload)
        return ok(project.model_dump(mode="json"), status=201)

    @routes.put("/studio/api/projects/order")
    @handle_errors
    async def reorder_projects(request: web.Request) -> web.Response:
        payload = ProjectReorder.model_validate(await read_object(request))
        await asyncio.to_thread(service.reorder, payload.ids)
        return web.Response(status=204)

    @routes.get("/studio/api/projects/{ref}")
    @handle_errors
    async def get_project(request: web.Request) -> web.Response:
        project = await asyncio.to_thread(service.get, request.match_info["ref"])
        return ok(project.model_dump(mode="json"))

    @routes.patch("/studio/api/projects/{ref}")
    @handle_errors
    async def update_project(request: web.Request) -> web.Response:
        payload = ProjectUpdate.model_validate(await read_object(request))
        project = await asyncio.to_thread(service.update, request.match_info["ref"], payload)
        return ok(project.model_dump(mode="json"))

    @routes.delete("/studio/api/projects/{ref}")
    @handle_errors
    async def delete_project(request: web.Request) -> web.Response:
        await asyncio.to_thread(service.delete, request.match_info["ref"])
        return web.Response(status=204)

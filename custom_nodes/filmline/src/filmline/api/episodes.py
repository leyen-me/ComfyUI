"""分集接口。

    GET    /studio/api/projects/{ref}/episodes            列表
    POST   /studio/api/projects/{ref}/episodes            新建（自动 EP01 / 第 1 集）
    PUT    /studio/api/projects/{ref}/episodes/order      排序（需覆盖全部分集）
    GET    /studio/api/projects/{ref}/episodes/{code}     按编号查
    PATCH  /studio/api/episodes/{id}                      改名 / 改简介
    DELETE /studio/api/episodes/{id}                      软删除
"""

from __future__ import annotations

import asyncio

from aiohttp import web

from ..domain.episodes import EpisodeService
from ..domain.projects import ProjectService
from ..domain.schemas import EpisodeCreate, EpisodeReorder, EpisodeUpdate
from ..errors import InvalidArgument
from .http import handle_errors, ok, read_object


def _project_id(ref: str) -> int:
    return ProjectService().get(ref).id


def _episode_id(request: web.Request) -> int:
    raw = request.match_info["episode_id"]
    try:
        return int(raw)
    except ValueError as exc:
        raise InvalidArgument("episode_id 必须是整数") from exc


def register_episode_routes(routes: web.RouteTableDef) -> None:
    service = EpisodeService()

    @routes.get("/studio/api/projects/{ref}/episodes")
    @handle_errors
    async def list_episodes(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        episodes = await asyncio.to_thread(service.list, project_id)
        items = [episode.model_dump(mode="json") for episode in episodes]
        return ok({"items": items, "total": len(items)})

    @routes.post("/studio/api/projects/{ref}/episodes")
    @handle_errors
    async def create_episode(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        payload = EpisodeCreate.model_validate(await read_object(request))
        episode = await asyncio.to_thread(service.create, project_id, payload)
        return ok(episode.model_dump(mode="json"), status=201)

    @routes.put("/studio/api/projects/{ref}/episodes/order")
    @handle_errors
    async def reorder_episodes(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        payload = EpisodeReorder.model_validate(await read_object(request))
        await asyncio.to_thread(service.reorder, project_id, payload.ids)
        return web.Response(status=204)

    @routes.get("/studio/api/projects/{ref}/episodes/{code}")
    @handle_errors
    async def get_episode(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        episode = await asyncio.to_thread(
            service.get_in_project, project_id, request.match_info["code"]
        )
        return ok(episode.model_dump(mode="json"))

    @routes.patch("/studio/api/episodes/{episode_id}")
    @handle_errors
    async def update_episode(request: web.Request) -> web.Response:
        payload = EpisodeUpdate.model_validate(await read_object(request))
        episode = await asyncio.to_thread(service.update, _episode_id(request), payload)
        return ok(episode.model_dump(mode="json"))

    @routes.delete("/studio/api/episodes/{episode_id}")
    @handle_errors
    async def delete_episode(request: web.Request) -> web.Response:
        await asyncio.to_thread(service.delete, _episode_id(request))
        return web.Response(status=204)

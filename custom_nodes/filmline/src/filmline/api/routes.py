"""路由装配：把 /studio 与 /studio/api/* 挂到 ComfyUI 的 aiohttp 应用上。

注意不要占用 ComfyUI 已有路径（/、/api/*、/ws、/view、/object_info 等）。
"""

from __future__ import annotations

import logging

from aiohttp import web

from .. import __version__, config, db
from ..domain.projects import ProjectService
from .assets import register_asset_routes
from .http import handle_errors, ok
from .projects import register_project_routes

_LOG = logging.getLogger("filmline")

API_PREFIX = "/studio/api"
STATIC_PREFIX = "/studio/static"


def register_routes(app: web.Application) -> None:
    # 提前初始化数据库：配置问题在启动日志里就能看到，而不是等到第一次请求
    db.init()

    routes = web.RouteTableDef()
    register_project_routes(routes)
    register_asset_routes(routes)

    @routes.get(f"{API_PREFIX}/health")
    @handle_errors
    async def health(_: web.Request) -> web.Response:
        projects = ProjectService().list(limit=1)
        return ok(
            {
                "version": __version__,
                "db": str(config.db_path()),
                "schema_version": _schema_version(),
                "projects": projects.total,
            }
        )

    app.add_routes(routes)
    _register_web(app)


def _schema_version() -> int:
    from ..db.migrations import current_version

    return current_version(db.get_engine())


def _register_web(app: web.Application) -> None:
    web_root = config.web_dir()
    index_file = web_root / "index.html"
    if not index_file.is_file():
        _LOG.warning("前端资源缺失: %s", index_file)
        return

    def index_response() -> web.StreamResponse:
        return web.FileResponse(index_file, headers={"Cache-Control": "no-store"})

    async def index(_: web.Request) -> web.StreamResponse:
        return index_response()

    async def spa(request: web.Request) -> web.StreamResponse:
        # 前端使用 history 路由，/studio/projects/xxx 这类地址需要回落到 index.html
        if request.path.startswith(API_PREFIX) or request.path.startswith(STATIC_PREFIX):
            raise web.HTTPNotFound()
        return index_response()

    app.router.add_get("/studio", index)
    app.router.add_get("/studio/", index)
    app.router.add_static(STATIC_PREFIX, web_root, show_index=False)
    # 兜底必须最后注册，否则会吞掉上面的具体路由
    app.router.add_get("/studio/{tail:.*}", spa)

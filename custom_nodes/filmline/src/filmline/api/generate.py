"""生成接口：把面板参数提交给 ComfyUI，产物登记为 AI 资产。

    POST /studio/api/projects/{ref}/generate?episode=EP01
    body: {kind, prompt, size, count?, duration?}
"""

from __future__ import annotations

import asyncio
import logging
import time

from aiohttp import web

from .. import generation, storage
from ..domain.assets import AssetService
from ..domain.episodes import EpisodeService
from ..domain.projects import ProjectService
from ..domain.schemas import AssetKind, AssetSource
from ..errors import AppError, InvalidArgument
from .http import handle_errors, ok, read_object

_LOG = logging.getLogger("filmline")


def _episode_scope(request: web.Request, project_id: int) -> tuple[int | None, str]:
    raw = (request.query.get("episode") or "").strip()
    if not raw:
        return None, "project"
    code = raw.upper()
    return EpisodeService().resolve_id(project_id, code), code


def register_generate_routes(routes: web.RouteTableDef) -> None:
    assets = AssetService()

    @routes.post("/studio/api/projects/{ref}/generate")
    @handle_errors
    async def generate(request: web.Request) -> web.Response:
        payload = await read_object(request)
        kind = str(payload.get("kind") or "image")
        prompt = str(payload.get("prompt") or "")
        size = str(payload.get("size") or ("16:9" if kind == "video" else "1:1"))

        if kind not in ("image", "video"):
            raise InvalidArgument("kind 只支持 image / video")
        if len(prompt) > 4000:
            raise InvalidArgument("提示词最长 4000 字符")

        project = await asyncio.to_thread(ProjectService().get, request.match_info["ref"])
        episode_id, scope = await asyncio.to_thread(_episode_scope, request, project.id)

        if kind == "image":
            count = payload.get("count", 1)
            if not isinstance(count, int):
                raise InvalidArgument("count 必须是整数")
            workflow = generation.image_workflow(
                prompt=prompt, size=size, count=count, prefix=f"filmline/{project.code}/{scope}"
            )
        else:
            duration = payload.get("duration", 5)
            if not isinstance(duration, int):
                raise InvalidArgument("duration 必须是整数")
            workflow = generation.video_workflow(
                prompt=prompt,
                size=size,
                duration=duration,
                prefix=f"filmline/{project.code}/{scope}",
            )

        started = time.monotonic()
        try:
            products = await generation.run(
                workflow, timeout=generation.timeout_for(workflow.kind)
            )
        except AppError:
            raise
        except Exception as exc:  # 网络 / ComfyUI 进程异常
            _LOG.exception("生成失败")
            raise generation.GenerationFailed(f"生成失败: {exc}") from exc

        created = []
        for product in products:
            relative, target = storage.allocate(project.id, scope, product.suffix)
            target.write_bytes(product.data)
            asset = await asyncio.to_thread(
                assets.create_from_file,
                project.id,
                name=product.filename,
                kind=AssetKind(workflow.kind),
                source=AssetSource.ai,
                relative_path=relative,
                mime_type=storage.MIME_BY_SUFFIX.get(
                    product.suffix.lower(), "application/octet-stream"
                ),
                size_bytes=len(product.data),
                episode_id=episode_id,
                meta=workflow.meta,
            )
            created.append(asset.model_dump(mode="json"))

        elapsed = round(time.monotonic() - started, 1)
        _LOG.info("生成完成: %s 个 %s，耗时 %ss", len(created), kind, elapsed)
        return ok({"items": created, "kind": kind, "elapsed": elapsed}, status=201)

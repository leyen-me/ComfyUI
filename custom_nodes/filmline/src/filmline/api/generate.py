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
from ..clock import utcnow
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

        raw_refs = payload.get("refs") or []
        if not isinstance(raw_refs, list) or not all(
            isinstance(item, int) and item > 0 for item in raw_refs
        ):
            raise InvalidArgument("refs 必须是资产 id 数组")
        ref_paths = await asyncio.to_thread(
            assets.resolve_ref_paths,
            project.id,
            raw_refs,
            limit=generation.MAX_IMAGE_REFS if kind == "image" else generation.MAX_VIDEO_REFS,
        )

        if kind == "image":
            tier = str(payload.get("resolution") or "1k").lower()
            if tier not in generation.IMAGE_TIERS:
                raise InvalidArgument(f"resolution 只支持: {' / '.join(generation.IMAGE_TIERS)}")
            count = payload.get("count", 1)
            if not isinstance(count, int):
                raise InvalidArgument("count 必须是整数")
            if ref_paths:
                count = 1
            workflow = generation.image_workflow(
                prompt=prompt,
                size=size,
                count=count,
                tier=tier,
                refs=ref_paths,
                prefix=f"filmline/{project.code}/{scope}",
            )
        else:
            duration = payload.get("duration", 5)
            if not isinstance(duration, int):
                raise InvalidArgument("duration 必须是整数")
            workflow = generation.video_workflow(
                prompt=prompt,
                size=size,
                duration=duration,
                refs=ref_paths,
                prefix=f"filmline/{project.code}/{scope}",
            )

        started_wall = utcnow()
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

        elapsed = round(time.monotonic() - started, 1)
        created = []
        for product in products:
            relative, target = storage.allocate(project.id, scope, product.suffix)
            target.write_bytes(product.data)

            # 参考图模式下实际尺寸由参考图决定，以产物为准修正元数据
            meta = dict(workflow.meta)
            meta["ref_ids"] = raw_refs
            if workflow.kind == "image":
                try:
                    from PIL import Image

                    with Image.open(target) as produced:
                        meta["width"], meta["height"] = produced.width, produced.height
                        meta["size"] = generation.ratio_label(produced.width, produced.height)
                except Exception:
                    _LOG.warning("无法读取产物尺寸: %s", target)
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
                meta=meta,
                gen_started_at=started_wall,
                gen_elapsed_ms=int(elapsed * 1000),
            )
            created.append(asset.model_dump(mode="json"))

        _LOG.info("生成完成: %s 个 %s，耗时 %ss", len(created), kind, elapsed)
        return ok({"items": created, "kind": kind, "elapsed": elapsed}, status=201)

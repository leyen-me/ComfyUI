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


def _optional_asset_id(raw: object, field: str) -> int | None:
    """首尾帧字段允许为空；其余情况必须是正整数资产 id。"""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        raise InvalidArgument(f"{field} 必须是资产 id")
    return raw


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
            raw_refs = payload.get("refs") or []
            if not isinstance(raw_refs, list) or not all(
                isinstance(item, int) and not isinstance(item, bool) and item > 0
                for item in raw_refs
            ):
                raise InvalidArgument("refs 必须是资产 id 数组")
            ref_paths = await asyncio.to_thread(
                assets.resolve_ref_paths,
                project.id,
                raw_refs,
                limit=generation.MAX_IMAGE_REFS,
            )

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
            mode = str(payload.get("mode") or "keyframes")
            if mode not in ("keyframes", "reference"):
                raise InvalidArgument("视频生成方式只支持 keyframes / reference")

            first_id = _optional_asset_id(payload.get("first_frame_id"), "first_frame_id")
            last_id = _optional_asset_id(payload.get("last_frame_id"), "last_frame_id")
            raw_refs: list[int] = []
            frame_ids: list[int] = []

            video_tier = str(payload.get("resolution") or "768").lower()
            if video_tier not in generation.VIDEO_TIERS:
                raise InvalidArgument(
                    f"视频分辨率只支持: {' / '.join(generation.VIDEO_TIERS)}"
                )
            duration = payload.get("duration", 5)
            if not isinstance(duration, int):
                raise InvalidArgument("duration 必须是整数")

            if mode == "keyframes":
                # 旧客户端只发 refs（最多 1 张），按首帧解释
                legacy_refs = payload.get("refs")
                if legacy_refs is not None:
                    if first_id is not None or last_id is not None:
                        raise InvalidArgument(
                            "refs 与 first_frame_id / last_frame_id 不能同时使用"
                        )
                    if not isinstance(legacy_refs, list) or not all(
                        isinstance(item, int) and not isinstance(item, bool) and item > 0
                        for item in legacy_refs
                    ):
                        raise InvalidArgument("refs 必须是资产 id 数组")
                    if len(legacy_refs) > 1:
                        raise InvalidArgument("视频首帧只支持 1 张")
                    if legacy_refs:
                        first_id = legacy_refs[0]

                frame_ids = [
                    asset_id for asset_id in (first_id, last_id) if asset_id is not None
                ]
                frame_paths = await asyncio.to_thread(
                    assets.resolve_ref_paths,
                    project.id,
                    frame_ids,
                    limit=2,
                    label="首尾帧图片",
                )
                paths_by_id = dict(zip(frame_ids, frame_paths))
                workflow = generation.video_workflow(
                    prompt=prompt,
                    size=size,
                    duration=duration,
                    tier=video_tier,
                    first_frame=paths_by_id.get(first_id) if first_id is not None else None,
                    last_frame=paths_by_id.get(last_id) if last_id is not None else None,
                    prefix=f"filmline/{project.code}/{scope}",
                )
            else:
                if first_id is not None or last_id is not None:
                    raise InvalidArgument("参考生成不能使用 first_frame_id / last_frame_id")

                raw_refs = payload.get("refs") or []
                if not isinstance(raw_refs, list) or not raw_refs or not all(
                    isinstance(item, int) and not isinstance(item, bool) and item > 0
                    for item in raw_refs
                ):
                    raise InvalidArgument("参考生成至少需要 1 张图片")
                ref_paths = await asyncio.to_thread(
                    assets.resolve_ref_paths,
                    project.id,
                    raw_refs,
                    limit=generation.MAX_VIDEO_REFS,
                    label="参考图",
                )
                workflow = generation.video_reference_workflow(
                    prompt=prompt,
                    size=size,
                    duration=duration,
                    tier=video_tier,
                    refs=ref_paths,
                    prefix=f"filmline/{project.code}/{scope}",
                )

        started_wall = utcnow()
        started = time.monotonic()
        try:
            products, exec_seconds = await generation.run(
                workflow, timeout=generation.timeout_for(workflow.kind)
            )
        except AppError:
            raise
        except Exception as exc:  # 网络 / ComfyUI 进程异常
            _LOG.exception("生成失败")
            raise generation.GenerationFailed(f"生成失败: {exc}") from exc

        wall = round(time.monotonic() - started, 1)
        # 对外展示的耗时只用 ComfyUI 的真实执行时间；排队时间另记
        elapsed = round(exec_seconds, 1) if exec_seconds is not None else wall
        created = []
        for product in products:
            relative, target = storage.allocate(project.id, scope, product.suffix)
            target.write_bytes(product.data)

            # 参考图模式下实际尺寸由参考图决定，以产物为准修正元数据
            meta = dict(workflow.meta)
            if kind == "image":
                meta["ref_ids"] = raw_refs
            else:
                meta["video_mode"] = mode
                meta["ref_ids"] = raw_refs if mode == "reference" else frame_ids
                if mode == "keyframes":
                    meta["first_frame_id"] = first_id
                    meta["last_frame_id"] = last_id
            meta["queue_ms"] = max(0, int(round((wall - elapsed) * 1000)))
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

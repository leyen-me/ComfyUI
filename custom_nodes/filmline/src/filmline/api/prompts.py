"""提示词优化接口：后端代理 DeepSeek，前端不接触 API Key。"""

from __future__ import annotations

import asyncio
from typing import Any

from aiohttp import web

from .. import llm, media, storage
from ..domain.assets import AssetService
from ..domain.projects import ProjectService
from ..errors import InvalidArgument
from .http import handle_errors, ok, read_object

API_PREFIX = "/studio/api"
MAX_IMAGES = 4
MAX_IMAGE_DATA_URL_TOTAL = 24 * 1024 * 1024


def _reference_list(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > 12:
        raise InvalidArgument("references 必须是不超过 12 项的数组")
    result: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise InvalidArgument("references 每项必须是对象")
        label = str(item.get("label") or "").strip()
        kind = str(item.get("kind") or "").strip()
        if not label or kind not in ("image", "video", "audio"):
            raise InvalidArgument("references 需要 label 与 image/video/audio kind")
        result.append({"label": label[:60], "kind": kind})
    return result


def _keyframes(raw: object) -> dict:
    if raw is None:
        return {"first": False, "last": False}
    if not isinstance(raw, dict):
        raise InvalidArgument("keyframes 必须是对象")
    return {"first": bool(raw.get("first")), "last": bool(raw.get("last"))}


def _images(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list) or len(raw) > MAX_IMAGES:
        raise InvalidArgument(f"images 必须是不超过 {MAX_IMAGES} 项的数组")
    result: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise InvalidArgument("images 每项必须是对象")
        asset_id = item.get("asset_id")
        if isinstance(asset_id, bool) or not isinstance(asset_id, int) or asset_id <= 0:
            raise InvalidArgument("images.asset_id 必须是资产 id")
        label = str(item.get("label") or "").strip()
        role = str(item.get("role") or "").strip()
        if not label or role not in ("first_frame", "last_frame", "reference"):
            raise InvalidArgument("images 需要 label 与 first_frame/last_frame/reference role")
        result.append({"asset_id": asset_id, "label": label[:60], "role": role})
    if len({item["asset_id"] for item in result}) != len(result):
        raise InvalidArgument("images 不能重复")
    return result


def register_prompt_routes(routes: web.RouteTableDef) -> None:
    @routes.post(f"{API_PREFIX}/prompts/optimize")
    @handle_errors
    async def optimize_prompt(request: web.Request) -> web.Response:
        payload = await read_object(request)
        mode = str(payload.get("mode") or "video")
        if mode != "video":
            raise InvalidArgument("AI 优化目前只支持视频提示词")
        video_mode = str(payload.get("video_mode") or "keyframes")
        if video_mode not in ("keyframes", "reference", "hybrid"):
            raise InvalidArgument("video_mode 只支持 keyframes / reference / hybrid")
        prompt = str(payload.get("prompt") or "").strip()
        if not prompt:
            raise InvalidArgument("请先写下提示词")

        image_items = _images(payload.get("images"))
        project_ref = str(payload.get("project_ref") or "").strip()
        if image_items and not project_ref:
            raise InvalidArgument("发送图片时必须提供 project_ref")

        images: list[dict[str, Any]] = []
        if image_items:
            project = await asyncio.to_thread(ProjectService().get, project_ref)
            resolved = await asyncio.to_thread(
                AssetService().resolve_assets,
                project.id,
                [item["asset_id"] for item in image_items],
                kinds={"image"},
                limit=MAX_IMAGES,
                label="AI 参考图片",
            )
            total = 0
            for item, asset in zip(image_items, resolved):
                target = storage.resolve(asset.path)
                if not target.is_file():
                    raise InvalidArgument(f"图片资产文件已丢失: {asset.name}")
                data_url = await asyncio.to_thread(media.image_data_url, target)
                total += len(data_url)
                if total > MAX_IMAGE_DATA_URL_TOTAL:
                    raise InvalidArgument("发送给 AI 的图片总大小过大")
                images.append(
                    {"label": item["label"], "role": item["role"], "data_url": data_url}
                )

        request_payload: dict[str, Any] = {
            "video_mode": video_mode,
            "prompt": prompt,
            "keyframes": _keyframes(payload.get("keyframes")),
            "references": _reference_list(payload.get("references")),
            "size": str(payload.get("size") or "16:9"),
            "duration": payload.get("duration"),
            "no_subtitles": bool(payload.get("no_subtitles", True)),
        }
        if images:
            request_payload["images"] = [
                {"label": image["label"], "role": image["role"]} for image in images
            ]
        result = await llm.optimize_prompt(request_payload, images=images)
        return ok(result)

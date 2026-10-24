"""资产接口。

    GET    /studio/api/projects/{ref}/assets            列表（kind 过滤）
    GET    /studio/api/projects/{ref}/assets/counts     各分类数量
    POST   /studio/api/projects/{ref}/assets            新建文本资产
    POST   /studio/api/projects/{ref}/assets/upload     上传图片/视频（source=user|ai）
    GET    /studio/api/assets/{id}/content              文件内容
    PATCH  /studio/api/assets/{id}                      改名 / 改文本内容
    DELETE /studio/api/assets/{id}                      软删除
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import uuid4

from aiohttp import web

from .. import media, storage
from ..domain.assets import AssetService
from ..domain.episodes import EpisodeService
from ..domain.projects import ProjectService
from ..domain.schemas import AssetKind, AssetSource, AssetUpdate, TextAssetCreate
from ..errors import InvalidArgument, NotFound
from .http import handle_errors, ok, parse_int, read_object

MAX_UPLOAD_BYTES = 1024 * 1024 * 1024  # 1 GiB
CHUNK = 1024 * 1024


def _project_id(ref: str) -> int:
    return ProjectService().get(ref).id


def _episode_scope(request: web.Request, project_id: int) -> tuple[int | None, str]:
    """解析 ?episode=EP01，返回（分集 id 或 None, 存储目录名）。"""
    raw = (request.query.get("episode") or "").strip()
    if not raw:
        return None, "project"
    code = raw.upper()
    return EpisodeService().resolve_id(project_id, code), code


def _asset_id(request: web.Request) -> int:
    raw = request.match_info["asset_id"]
    try:
        return int(raw)
    except ValueError as exc:
        raise InvalidArgument("asset_id 必须是整数") from exc


def _parse_kind(raw: str | None) -> AssetKind | None:
    if raw is None or raw == "":
        return None
    try:
        return AssetKind(raw)
    except ValueError as exc:
        raise InvalidArgument("kind 只允许 text / image / video") from exc


async def _save_upload(request: web.Request) -> tuple[str, Path, int]:
    """把上传文件流式写入临时目录，返回（原始文件名, 临时路径, 字节数）。"""
    reader = await request.multipart()
    part = await reader.next()
    if part is None or part.name != "file":
        raise InvalidArgument("缺少文件字段 file")
    filename = getattr(part, "filename", None)
    if not filename:
        raise InvalidArgument("上传内容必须是文件")

    suffix = Path(filename).suffix
    storage.kind_for_suffix(suffix)  # 提前校验类型，避免白写盘

    tmp_path = storage.tmp_dir() / f"{uuid4().hex}{suffix.lower()}"
    size = 0
    try:
        with tmp_path.open("wb") as handle:
            while True:
                chunk = await part.read_chunk(CHUNK)
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise InvalidArgument("文件超过 1 GiB 上限")
                handle.write(chunk)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise

    return filename, tmp_path, size


def _parse_source(raw: str | None) -> AssetSource:
    if raw is None or raw == "":
        return AssetSource.user
    try:
        return AssetSource(raw)
    except ValueError as exc:
        raise InvalidArgument("source 只允许 user / ai") from exc


def _parse_meta(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidArgument("meta 不是合法 JSON") from exc
    if not isinstance(value, dict):
        raise InvalidArgument("meta 必须是 JSON 对象")
    return value


def register_asset_routes(routes: web.RouteTableDef) -> None:
    service = AssetService()

    @routes.get("/studio/api/projects/{ref}/assets")
    @handle_errors
    async def list_assets(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        episode_id, _ = await asyncio.to_thread(_episode_scope, request, project_id)
        result = await asyncio.to_thread(
            service.list,
            project_id,
            episode_id=episode_id,
            kind=_parse_kind(request.query.get("kind")),
            limit=parse_int(request, "limit", default=200, minimum=1, maximum=200),
            offset=parse_int(request, "offset", default=0, minimum=0, maximum=10_000_000),
        )
        return ok(result.model_dump(mode="json"))

    @routes.get("/studio/api/projects/{ref}/assets/counts")
    @handle_errors
    async def asset_counts(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        episode_id, _ = await asyncio.to_thread(_episode_scope, request, project_id)
        counts = await asyncio.to_thread(service.counts, project_id, episode_id=episode_id)
        return ok(counts.model_dump(mode="json"))

    @routes.post("/studio/api/projects/{ref}/assets")
    @handle_errors
    async def create_text_asset(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        episode_id, _ = await asyncio.to_thread(_episode_scope, request, project_id)
        payload = TextAssetCreate.model_validate(await read_object(request))
        asset = await asyncio.to_thread(
            service.create_text, project_id, payload, episode_id=episode_id
        )
        return ok(asset.model_dump(mode="json"), status=201)

    @routes.post("/studio/api/projects/{ref}/assets/upload")
    @handle_errors
    async def upload_asset(request: web.Request) -> web.Response:
        project_id = await asyncio.to_thread(_project_id, request.match_info["ref"])
        episode_id, scope = await asyncio.to_thread(_episode_scope, request, project_id)

        original_name, tmp_path, size = await _save_upload(request)
        try:
            suffix = tmp_path.suffix
            kind = AssetKind(storage.kind_for_suffix(suffix))
            source = _parse_source(request.query.get("source"))
            meta = _parse_meta(request.query.get("meta"))
            name = request.query.get("name") or original_name

            if kind in (AssetKind.video, AssetKind.audio):
                # 探测只用于补全元数据；失败不阻塞上传，引用时生成接口会再次严格校验
                try:
                    info = await asyncio.to_thread(media.probe, tmp_path)
                except InvalidArgument:
                    info = None
                if info is not None:
                    merged = dict(meta or {})
                    merged.update(
                        {
                            "duration": info.duration,
                            "fps": info.fps,
                            "has_audio": info.has_audio,
                            "width": info.width,
                            "height": info.height,
                            "sample_rate": info.sample_rate,
                            "channels": info.channels,
                        }
                    )
                    meta = merged

            relative, target = storage.allocate(project_id, scope, suffix)
            tmp_path.replace(target)

            asset = await asyncio.to_thread(
                service.create_from_file,
                project_id,
                name=name,
                kind=kind,
                source=source,
                relative_path=relative,
                mime_type=storage.MIME_BY_SUFFIX.get(suffix.lower(), "application/octet-stream"),
                size_bytes=size,
                episode_id=episode_id,
                meta=meta,
            )
        except BaseException:
            tmp_path.unlink(missing_ok=True)
            raise

        return ok(asset.model_dump(mode="json"), status=201)

    @routes.get("/studio/api/assets/{asset_id}")
    @handle_errors
    async def get_asset(request: web.Request) -> web.Response:
        asset = await asyncio.to_thread(service.get, _asset_id(request))
        return ok(asset.model_dump(mode="json"))

    @routes.get("/studio/api/assets/{asset_id}/content")
    @handle_errors
    async def asset_content(request: web.Request) -> web.StreamResponse:
        asset_id = _asset_id(request)
        relative, mime = await asyncio.to_thread(service.get_row_for_content, asset_id)
        path = storage.resolve(relative)
        if not path.is_file():
            raise NotFound("资产文件已丢失")
        return web.FileResponse(
            path,
            headers={
                "Content-Type": mime,
                "Cache-Control": "private, max-age=3600",
            },
        )

    @routes.get("/studio/api/assets/{asset_id}/media-info")
    @handle_errors
    async def asset_media_info(request: web.Request) -> web.Response:
        asset = await asyncio.to_thread(service.get, _asset_id(request))
        if asset.kind not in (AssetKind.video.value, AssetKind.audio.value):
            raise InvalidArgument("只有视频或音频资产可以探测媒体信息")
        relative, _ = await asyncio.to_thread(service.get_row_for_content, asset.id)
        path = storage.resolve(relative)
        if not path.is_file():
            raise NotFound("资产文件已丢失")
        info = await asyncio.to_thread(media.probe, path)
        return ok(info.as_dict())

    @routes.patch("/studio/api/assets/{asset_id}")
    @handle_errors
    async def update_asset(request: web.Request) -> web.Response:
        asset_id = _asset_id(request)
        payload = AssetUpdate.model_validate(await read_object(request))
        asset = await asyncio.to_thread(service.update, asset_id, payload)
        return ok(asset.model_dump(mode="json"))

    @routes.delete("/studio/api/assets/{asset_id}")
    @handle_errors
    async def delete_asset(request: web.Request) -> web.Response:
        asset_id = _asset_id(request)
        await asyncio.to_thread(service.delete, asset_id)
        return web.Response(status=204)

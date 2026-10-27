"""DeepSeek Files API：图片上传与 file_id 缓存。

官方 ``POST /files``（multipart，``purpose=user_data``）单文件最大 64 MiB；
对话里用 ``{"type": "file", "file_id": ...}`` 引用，不受 32 MiB 内联限制。

策略：
* ``inline``：只走 base64，不调用本模块；
* ``files`` / ``auto``：先查内容哈希缓存，命中且未过期直接复用；
* 上传失败且内容 <=32 MiB 时回退内联，保证可用性；超过 32 MiB 只能报错。

本模块只处理“已编码好的 data URL”，也就是说上传的字节与内联时完全一致，
不会出现“模型看到的是另一张图”的问题。
"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import logging
from dataclasses import dataclass
from datetime import timedelta

import aiohttp

from ..clock import to_iso, utcnow
from ..config import AgentSettings, agent_settings
from ..errors import InvalidArgument, ServiceUnavailable
from . import store

_LOG = logging.getLogger("filmline")

FILES_PATH = "/files"
MAX_UPLOAD_BYTES = 64 * 1024 * 1024
MAX_INLINE_BYTES = 32 * 1024 * 1024
UPLOAD_TIMEOUT = 120.0


class FileError(Exception):
    def __init__(self, message: str, *, code: str = "file_error") -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class UploadedFile:
    file_id: str
    expires_at: str | None


def files_url(base_url: str) -> str:
    """Files API 在根路径；base_url 带 /v1 时去掉。"""
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + FILES_PATH


def decode_data_url(data_url: str) -> tuple[str, bytes]:
    try:
        header, encoded = data_url.split(",", 1)
    except ValueError as exc:
        raise FileError("图片 data URL 格式异常", code="invalid_image") from exc
    if not header.startswith("data:") or ";base64" not in header:
        raise FileError("图片不是 base64 data URL", code="invalid_image")
    mime = header[5:].split(";", 1)[0] or "image/jpeg"
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise FileError("图片 base64 解码失败", code="invalid_image") from exc
    if not raw:
        raise FileError("图片内容为空", code="invalid_image")
    return mime, raw


def _filename(name: str, mime: str) -> str:
    clean = (name or "").strip().replace("\x00", "")[:200]
    if not clean:
        extension = {"image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}.get(
            mime, ".jpg"
        )
        clean = "image" + extension
    return clean


async def _upload(
    settings: AgentSettings,
    raw: bytes,
    *,
    filename: str,
    mime: str,
    expiry_seconds: int,
) -> dict:
    form = aiohttp.FormData()
    form.add_field("purpose", "user_data")
    form.add_field("file", raw, filename=filename, content_type=mime)
    form.add_field("expires_after[anchor]", "created_at")
    form.add_field("expires_after[seconds]", str(expiry_seconds))

    headers = {"Authorization": f"Bearer {settings.api_key}"}
    timeout = aiohttp.ClientTimeout(total=UPLOAD_TIMEOUT)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(files_url(settings.base_url), headers=headers, data=form) as response:
                if response.status != 200:
                    text = (await response.text())[:300]
                    _LOG.warning("Files API 上传失败: HTTP %s %s", response.status, text)
                    if response.status in (401, 403):
                        raise FileError("Files API Key 无效或无权限", code="unauthorized")
                    if response.status == 429:
                        raise FileError("Files API 频率限制", code="rate_limited")
                    raise FileError("Files API 上传失败", code="upload_failed")
                value = await response.json(content_type=None)
                if not isinstance(value, dict) or not value.get("id"):
                    raise FileError("Files API 返回格式异常", code="bad_response")
                return value
    except FileError:
        raise
    except asyncio.TimeoutError as exc:
        raise FileError("Files API 上传超时", code="timeout") from exc
    except aiohttp.ClientError as exc:
        raise FileError("连接 Files API 失败", code="network") from exc


async def ensure_file(
    data_url: str,
    filename: str,
    *,
    settings: AgentSettings | None = None,
) -> UploadedFile | None:
    """确保图片已上传，返回可放进消息的 file_id；inline 模式返回 None。"""
    settings = settings or agent_settings()
    if settings.image_mode == "inline" or not settings.api_key:
        return None

    try:
        mime, raw = decode_data_url(data_url)
    except FileError:
        return None
    if len(raw) > MAX_UPLOAD_BYTES:
        raise InvalidArgument("图片超过 Files API 64 MiB 上限")

    digest = hashlib.sha256(raw).hexdigest()
    cached = await asyncio.to_thread(store.get_agent_file, digest)
    if cached is not None:
        file_id, expires_at = cached
        if expires_at is None or expires_at > utcnow():
            await asyncio.to_thread(store.touch_agent_file, digest)
            return UploadedFile(file_id=file_id, expires_at=to_iso(expires_at))

    expiry = max(3600, min(2_592_000, settings.file_expiry_seconds))
    try:
        value = await _upload(
            settings,
            raw,
            filename=_filename(filename, mime),
            mime=mime,
            expiry_seconds=expiry,
        )
    except FileError as exc:
        if len(raw) <= MAX_INLINE_BYTES:
            _LOG.warning("Files API 不可用，回退内联图片: %s", exc)
            return None
        raise ServiceUnavailable("图片超过 32 MiB，且 Files API 上传失败，无法发送") from exc

    file_id = str(value["id"])
    expires_at = utcnow() + timedelta(seconds=expiry)
    try:
        await asyncio.to_thread(
            store.save_agent_file,
            digest,
            file_id=file_id,
            filename=_filename(filename, mime),
            size_bytes=len(raw),
            expires_at=expires_at,
        )
    except Exception:
        # 并发上传同一内容时唯一索引会冲突；以已存在的记录为准
        existing = await asyncio.to_thread(store.get_agent_file, digest)
        if existing is not None:
            cached_id, cached_expiry = existing
            return UploadedFile(file_id=cached_id, expires_at=to_iso(cached_expiry))
        raise
    return UploadedFile(file_id=file_id, expires_at=to_iso(expires_at))

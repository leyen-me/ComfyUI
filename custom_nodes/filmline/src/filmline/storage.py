"""资产文件存储：只保存相对路径，文件落在 data/assets 下。"""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from . import config
from .errors import InvalidArgument

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
VIDEO_SUFFIXES = {".mp4", ".webm", ".mov", ".mkv", ".m4v"}

MIME_BY_SUFFIX = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".avif": "image/avif",
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".m4v": "video/x-m4v",
}


def assets_dir() -> Path:
    path = config.data_dir() / "assets"
    path.mkdir(parents=True, exist_ok=True)
    return path


def tmp_dir() -> Path:
    path = config.data_dir() / "tmp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def kind_for_suffix(suffix: str) -> str:
    lowered = suffix.lower()
    if lowered in IMAGE_SUFFIXES:
        return "image"
    if lowered in VIDEO_SUFFIXES:
        return "video"
    raise InvalidArgument(f"不支持的文件类型: {suffix or '未知'}")


def allocate(project_id: int, suffix: str) -> tuple[str, Path]:
    """为一次上传分配最终路径，返回（相对路径, 绝对路径）。"""
    relative = f"{project_id}/{uuid4().hex}{suffix.lower()}"
    absolute = assets_dir() / relative
    absolute.parent.mkdir(parents=True, exist_ok=True)
    return relative, absolute


def resolve(relative: str) -> Path:
    """把库里的相对路径还原成绝对路径，并确保没有越出资产目录。"""
    root = assets_dir().resolve()
    absolute = (root / relative).resolve()
    if root != absolute and root not in absolute.parents:
        raise InvalidArgument("非法的资产路径")
    return absolute

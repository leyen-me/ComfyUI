"""运行期配置：数据目录、数据库位置、Web 资源目录。

所有路径都支持环境变量覆盖，便于把数据放到 NAS / 独立盘上。
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

ENV_DATA_DIR = "FILMLINE_DATA_DIR"
ENV_DB_PATH = "FILMLINE_DB_PATH"

# src/filmline/config.py -> 上一级 src -> 扩展根目录
_EXT_ROOT = Path(__file__).resolve().parents[2]


def _comfy_user_directory() -> Path | None:
    try:
        import folder_paths  # type: ignore[import-not-found]

        return Path(folder_paths.get_user_directory())
    except Exception:
        return None


@lru_cache(maxsize=1)
def data_dir() -> Path:
    """数据根目录：默认跟随 ComfyUI 的 user 目录，重启/升级不丢数据。"""
    override = os.environ.get(ENV_DATA_DIR)
    if override:
        path = Path(override).expanduser()
    else:
        user_dir = _comfy_user_directory()
        path = user_dir / "filmline" if user_dir else _EXT_ROOT / "data"
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


@lru_cache(maxsize=1)
def db_path() -> Path:
    override = os.environ.get(ENV_DB_PATH)
    if override:
        path = Path(override).expanduser()
        path.parent.mkdir(parents=True, exist_ok=True)
        return path.resolve()
    return data_dir() / "filmline.db"


def web_dir() -> Path:
    return _EXT_ROOT / "web"


def reset_cache() -> None:
    """测试用：清掉路径缓存，让环境变量变更生效。"""
    data_dir.cache_clear()
    db_path.cache_clear()

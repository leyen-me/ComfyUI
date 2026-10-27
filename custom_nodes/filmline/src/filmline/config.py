"""运行期配置：数据目录、数据库位置、Web 资源目录、Agent 模型。

所有路径支持环境变量覆盖，便于把数据放到 NAS / 独立盘上；Agent 的
模型、思考开关、上下文窗口同样可配置，换 provider 时只改环境变量。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

ENV_DATA_DIR = "FILMLINE_DATA_DIR"
ENV_DB_PATH = "FILMLINE_DB_PATH"

# Agent 模型：FILMLINE_AGENT_* 优先，兼容已有的 DEEPSEEK_*
DEFAULT_CONTEXT_WINDOW = 1_000_000
DEFAULT_MODEL = "deepseek-flash"
DEFAULT_BASE_URL = "https://api.deepseek.com"

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


def _env(*names: str, default: str = "") -> str:
    for name in names:
        value = os.environ.get(name)
        if value is not None and value.strip():
            return value.strip()
    return default


def _env_int(names: tuple[str, ...], default: int, minimum: int, maximum: int) -> int:
    raw = _env(*names)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return min(maximum, max(minimum, value))


def _env_thinking(names: tuple[str, ...]) -> str:
    """auto 不发送思考字段（DeepSeek 默认开启，其它 provider 不受影响）；
    enabled / disabled 显式发送 `thinking`。"""
    raw = _env(*names).lower()
    if raw in ("", "auto", "omit", "default"):
        return "auto"
    if raw in ("0", "false", "no", "off", "disabled", "disable"):
        return "disabled"
    return "enabled"


# 官方映射表接受这些值；未知值一律回落到 high，避免 provider 直接 400
_REASONING_EFFORTS = {"minimal", "low", "medium", "high", "xhigh", "max", "ultra"}


def _env_effort(names: tuple[str, ...]) -> str:
    raw = _env(*names, default="high").lower()
    return raw if raw in _REASONING_EFFORTS else "high"


@dataclass(frozen=True)
class AgentSettings:
    """OpenAI 兼容端点的全部可变项；空 api_key 表示未配置。"""

    api_key: str
    base_url: str
    model: str
    thinking: str
    reasoning_effort: str
    context_window: int
    max_tokens: int
    timeout: float
    tick_seconds: int

    @property
    def configured(self) -> bool:
        return bool(self.api_key)


def agent_settings() -> AgentSettings:
    return AgentSettings(
        api_key=_env("FILMLINE_AGENT_API_KEY", "DEEPSEEK_API_KEY"),
        base_url=_env(
            "FILMLINE_AGENT_BASE_URL", "DEEPSEEK_BASE_URL", default=DEFAULT_BASE_URL
        ).rstrip("/"),
        model=_env("FILMLINE_AGENT_MODEL", "DEEPSEEK_MODEL", default=DEFAULT_MODEL),
        thinking=_env_thinking(("FILMLINE_AGENT_THINKING", "DEEPSEEK_THINKING")),
        reasoning_effort=_env_effort(
            ("FILMLINE_AGENT_REASONING_EFFORT", "DEEPSEEK_REASONING_EFFORT")
        ),
        context_window=_env_int(
            ("FILMLINE_AGENT_CONTEXT_WINDOW", "DEEPSEEK_CONTEXT_WINDOW"),
            DEFAULT_CONTEXT_WINDOW,
            16_000,
            4_000_000,
        ),
        max_tokens=_env_int(
            ("FILMLINE_AGENT_MAX_TOKENS", "DEEPSEEK_MAX_TOKENS"), 8192, 512, 65_536
        ),
        timeout=_env_int(("FILMLINE_AGENT_TIMEOUT", "DEEPSEEK_TIMEOUT"), 300, 30, 3600),
        tick_seconds=_env_int(("FILMLINE_AGENT_TICK_SECONDS",), 300, 60, 3600),
    )


def reset_cache() -> None:
    """测试用：清掉路径缓存，让环境变量变更生效。"""
    data_dir.cache_clear()
    db_path.cache_clear()

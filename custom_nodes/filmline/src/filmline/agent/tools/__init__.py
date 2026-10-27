"""工具注册入口：导入即完成注册。"""

from __future__ import annotations

from . import assets, generation, interaction, media_tools, workspace
from .base import (
    Tool,
    ToolContext,
    ToolOutcome,
    catalog,
    definitions,
    execute,
    failure,
    get,
    register,
    tool_names,
)

_REGISTERED = False


def ensure_registered() -> None:
    global _REGISTERED
    if _REGISTERED:
        return
    for module in (workspace, assets, media_tools, generation, interaction):
        module.register_tools()
    _REGISTERED = True


ensure_registered()

__all__ = [
    "Tool",
    "ToolContext",
    "ToolOutcome",
    "catalog",
    "definitions",
    "execute",
    "failure",
    "get",
    "register",
    "tool_names",
    "ensure_registered",
]

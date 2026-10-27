"""工具基类、统一输出信封与注册表。

所有工具：

* 入参先过 ``schema.validate``，未知字段直接拒绝；
* 输出固定 ``{ok, summary, data, error, meta}``，失败也不抛给模型；
* 执行过程通过 ``ctx.progress`` 推送 UI 进度，通过 ``ctx.emit`` 写事件。
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from ...errors import AppError
from ..schema import SchemaError, validate


@dataclass
class ToolOutcome:
    ok: bool = True
    summary: str = ""
    data: Any = None
    error: dict[str, Any] | None = None
    meta: dict[str, Any] = field(default_factory=dict)
    # 需要模型“看”的图片；由引擎在工具结果之后追加一条图片消息
    images: list[dict[str, str]] = field(default_factory=list)

    def as_payload(self) -> dict[str, Any]:
        body: dict[str, Any] = {
            "ok": self.ok,
            "summary": self.summary,
            "data": self.data,
            "error": self.error,
            "meta": self.meta,
        }
        return body


def failure(code: str, message: str, *, details: Any = None, summary: str = "") -> ToolOutcome:
    return ToolOutcome(
        ok=False,
        summary=summary or message,
        error={"code": code, "message": message, "details": details},
    )


@dataclass
class ToolContext:
    """一次工具调用能看到的全部上下文。"""

    session_id: int
    project_id: int
    project_code: str
    project_name: str
    tool_call_id: str = ""
    # 推送到 UI（同时入库），type 由引擎定义
    emit: Callable[[str, dict], Awaitable[None]] | None = None
    # 推送当前工具的进度文案
    progress: Callable[[str, int | None], Awaitable[None]] | None = None
    # 询问用户，返回按 id 组织的答案
    ask: Callable[[list[dict]], Awaitable[dict]] | None = None
    # 用户请求暂停：工具应在长循环里检查
    pause_requested: Callable[[], bool] | None = None
    # 注册需要完成通知的生成任务
    watch_task: Callable[[int], None] | None = None
    runner: Any = None

    async def notify(self, text: str, *, percent: int | None = None) -> None:
        if self.progress is not None:
            await self.progress(text, percent)

    def paused(self) -> bool:
        return bool(self.pause_requested and self.pause_requested())

    def check_pause(self) -> None:
        if self.paused():
            raise asyncio.CancelledError()


Handler = Callable[[ToolContext, dict[str, Any]], Awaitable[ToolOutcome]]


@dataclass(frozen=True)
class Tool:
    name: str
    label: str
    description: str
    parameters: dict[str, Any]
    handler: Handler
    # 写操作在 UI 上用不同颜色提示
    write: bool = False
    # 危险操作必须由模型先调用 ask_question 确认
    destructive: bool = False

    def definition(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


_REGISTRY: dict[str, Tool] = {}


def register(tool: Tool) -> None:
    if tool.name in _REGISTRY:
        raise ValueError(f"工具重复注册: {tool.name}")
    _REGISTRY[tool.name] = tool


def get(name: str) -> Tool | None:
    return _REGISTRY.get(name)


def definitions() -> list[dict[str, Any]]:
    return [tool.definition() for tool in _REGISTRY.values()]


def tool_names() -> list[str]:
    return list(_REGISTRY)


async def execute(name: str, arguments: dict, ctx: ToolContext) -> ToolOutcome:
    tool = _REGISTRY.get(name)
    if tool is None:
        return failure("unknown_tool", f"工具不存在: {name}")
    try:
        clean = validate(arguments, tool.parameters)
    except SchemaError as exc:
        return failure("invalid_arguments", str(exc), details={"field": exc.path})
    try:
        return await tool.handler(ctx, clean)
    except asyncio.CancelledError:
        raise
    except AppError as exc:
        return failure(exc.code, exc.message, details=exc.details)
    except Exception:
        import logging

        logging.getLogger("filmline").exception("工具 %s 执行失败", name)
        return failure("tool_failed", "工具执行失败，请稍后重试")

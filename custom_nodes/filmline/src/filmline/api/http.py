"""HTTP 适配层：统一响应信封、错误映射、请求体解析。

ComfyUI 的 aiohttp Application 是它自己的，我们无法安全地插入全局中间件
（会影响原版前端），因此错误处理收敛在这个装饰器里。
"""

from __future__ import annotations

import functools
import json
import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from aiohttp import web
from pydantic import ValidationError as PydanticValidationError

from ..errors import AppError, InvalidArgument

_LOG = logging.getLogger("filmline")

MAX_BODY_BYTES = 256 * 1024

Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]


def _ts() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def ok(data: Any = None, *, status: int = 200) -> web.Response:
    return web.json_response(
        {"ok": True, "data": data, "ts": _ts()},
        status=status,
        dumps=_dumps,
        headers={"Cache-Control": "no-store"},
    )


def fail(exc: AppError) -> web.Response:
    body = {"ok": False, "error": {"code": exc.code, "message": exc.message}, "ts": _ts()}
    if exc.details is not None:
        body["error"]["details"] = exc.details
    return web.json_response(
        body, status=exc.status, dumps=_dumps, headers={"Cache-Control": "no-store"}
    )


def _dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def handle_errors(handler: Handler) -> Handler:
    @functools.wraps(handler)
    async def wrapper(request: web.Request) -> web.StreamResponse:
        try:
            return await handler(request)
        except AppError as exc:
            return fail(exc)
        except PydanticValidationError as exc:
            details = [
                {"field": ".".join(str(p) for p in err["loc"]), "message": err["msg"]}
                for err in exc.errors()
            ]
            return fail(InvalidArgument("参数校验失败", details=details))
        except web.HTTPException:
            # 405 / 404 等由 aiohttp 自己处理
            raise
        except Exception:
            _LOG.exception("处理 %s %s 时发生未预期错误", request.method, request.path)
            return fail(AppError("服务器内部错误"))

    return wrapper


async def read_object(request: web.Request) -> dict[str, Any]:
    raw = await request.text()
    if len(raw.encode("utf-8", errors="ignore")) > MAX_BODY_BYTES:
        raise InvalidArgument("请求体过大")
    if not raw.strip():
        raise InvalidArgument("请求体不能为空")
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise InvalidArgument("请求体不是合法 JSON") from exc
    if not isinstance(payload, dict):
        raise InvalidArgument("请求体必须是 JSON 对象")
    return payload


def parse_int(request: web.Request, name: str, *, default: int, minimum: int, maximum: int) -> int:
    raw = request.query.get(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise InvalidArgument(f"{name} 必须是整数") from exc
    if not minimum <= value <= maximum:
        raise InvalidArgument(f"{name} 必须介于 {minimum} 和 {maximum} 之间")
    return value

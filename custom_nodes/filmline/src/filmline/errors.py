"""领域错误：HTTP 层据此映射状态码与错误码，业务层不需要知道 aiohttp。"""

from __future__ import annotations

from typing import Any


class AppError(Exception):
    """所有可预期错误的基类。"""

    code = "internal_error"
    status = 500
    default_message = "服务器内部错误"

    def __init__(self, message: str | None = None, *, details: Any = None) -> None:
        super().__init__(message or self.default_message)
        self.message = message or self.default_message
        self.details = details


class InvalidArgument(AppError):
    code = "invalid_argument"
    status = 400
    default_message = "请求参数不合法"


class NotFound(AppError):
    code = "not_found"
    status = 404
    default_message = "资源不存在"


class Conflict(AppError):
    code = "conflict"
    status = 409
    default_message = "资源冲突"

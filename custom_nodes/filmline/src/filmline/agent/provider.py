"""OpenAI 兼容的流式模型客户端（DeepSeek 官方格式）。

只做一件事：把 SSE 原样翻译成事件，不在这一层做任何重写。
``reasoning_content``、``content``、``tool_calls[].function.arguments``
的增量都会被原样保留，最终拼成完整字符串交给会话层入库。
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from typing import Any

import aiohttp

from ..config import AgentSettings

_LOG = logging.getLogger("filmline")


class ProviderError(Exception):
    def __init__(
        self,
        message: str,
        *,
        code: str = "provider_error",
        retryable: bool = False,
        status: int | None = None,
        retry_after: float | None = None,
    ):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.status = status
        self.retry_after = retry_after


def _error_detail(raw: str) -> str:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return raw.strip()[:300]
    if isinstance(value, dict):
        error = value.get("error")
        if isinstance(error, dict) and error.get("message"):
            return str(error["message"])[:300]
        if value.get("message"):
            return str(value["message"])[:300]
    return ""


def _status_error(
    status: int, raw: str, retry_after: float | None = None
) -> ProviderError:
    """按官方错误码映射；只有限速/超时/服务端故障适合重试。"""
    detail = _error_detail(raw)
    suffix = f"：{detail}" if detail and status in (400, 422) else ""
    if status == 400:
        return ProviderError(f"模型请求格式错误{suffix}", code="invalid_request", status=status)
    if status == 401:
        return ProviderError("模型 API Key 无效", code="unauthorized", status=status)
    if status == 402:
        return ProviderError("账户余额不足，请充值后重试", code="insufficient_balance", status=status)
    if status == 403:
        return ProviderError("模型接口拒绝访问", code="forbidden", status=status)
    if status == 408:
        return ProviderError(
            "模型请求超时", code="timeout", retryable=True, status=status, retry_after=retry_after
        )
    if status == 413:
        return ProviderError("请求体超过大小限制", code="too_large", status=status)
    if status == 422:
        return ProviderError(f"模型参数错误{suffix}", code="invalid_parameters", status=status)
    if status == 429:
        return ProviderError(
            "模型请求过于频繁", code="rate_limited", retryable=True, status=status,
            retry_after=retry_after,
        )
    if status >= 500:
        return ProviderError(
            "模型服务暂时不可用", code="upstream", retryable=True, status=status,
            retry_after=retry_after,
        )
    return ProviderError(f"模型接口返回 HTTP {status}", code="bad_request", status=status)


class StreamClient:
    def __init__(self, settings: AgentSettings) -> None:
        self._settings = settings

    @property
    def settings(self) -> AgentSettings:
        return self._settings

    def request_body(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        thinking: str | None = None,
        effort: str | None = None,
    ) -> dict[str, Any]:
        """按官方 OpenAI 格式组装请求；thinking 参数保持顶层（raw HTTP，不需要 extra_body）。

        ``thinking`` / ``effort`` 由会话级设置传入；为 None 时回落到全局配置。
        """
        settings = self._settings
        mode = settings.thinking if thinking is None else thinking
        level = settings.reasoning_effort if effort is None else effort
        body: dict[str, Any] = {
            "model": settings.model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_tokens": settings.max_tokens,
        }
        # auto：不发送思考字段。DeepSeek 默认开启且 effort=high，
        # 其它 provider 也不会收到不认识的参数。
        if mode != "auto":
            body["thinking"] = {"type": mode}
        if mode == "enabled":
            body["reasoning_effort"] = level
        return body

    async def stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
        *,
        thinking: str | None = None,
        effort: str | None = None,
    ) -> AsyncIterator[dict[str, Any]]:
        settings = self._settings
        if not settings.api_key:
            raise ProviderError("未配置模型 API Key", code="not_configured")

        body = self.request_body(messages, tools, thinking=thinking, effort=effort)
        headers = {
            "Authorization": f"Bearer {settings.api_key}",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        }
        timeout = aiohttp.ClientTimeout(total=None, sock_connect=20, sock_read=settings.timeout)

        content: list[str] = []
        reasoning: list[str] = []
        calls: dict[int, dict[str, str]] = {}
        usage: dict[str, Any] | None = None
        finish_reason: str | None = None

        try:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(
                    f"{settings.base_url}/chat/completions",
                    headers=headers,
                    json=body,
                ) as response:
                    if response.status != 200:
                        raw = (await response.text())[:800]
                        _LOG.warning("模型接口异常: HTTP %s %s", response.status, raw)
                        retry_after = None
                        header = response.headers.get("Retry-After")
                        if header:
                            try:
                                retry_after = max(0.0, float(header))
                            except ValueError:
                                retry_after = None
                        raise _status_error(response.status, raw, retry_after)

                    async for raw_line in response.content:
                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line or line.startswith(":"):
                            continue
                        if not line.startswith("data:"):
                            continue
                        payload = line[5:].strip()
                        if payload == "[DONE]":
                            break
                        try:
                            chunk = json.loads(payload)
                        except json.JSONDecodeError:
                            continue

                        if isinstance(chunk.get("usage"), dict):
                            usage = chunk["usage"]
                        choices = chunk.get("choices")
                        if not isinstance(choices, list) or not choices:
                            continue
                        choice = choices[0] or {}
                        delta = choice.get("delta") or {}
                        if choice.get("finish_reason"):
                            finish_reason = str(choice["finish_reason"])

                        thinking = delta.get("reasoning_content")
                        if isinstance(thinking, str) and thinking:
                            reasoning.append(thinking)
                            yield {"type": "reasoning", "text": thinking}

                        text = delta.get("content")
                        if isinstance(text, str) and text:
                            content.append(text)
                            yield {"type": "content", "text": text}

                        for item in delta.get("tool_calls") or []:
                            if not isinstance(item, dict):
                                continue
                            index = int(item.get("index") or 0)
                            slot = calls.setdefault(
                                index, {"id": "", "name": "", "arguments": ""}
                            )
                            if item.get("id"):
                                slot["id"] = str(item["id"])
                            function = item.get("function") or {}
                            if function.get("name"):
                                slot["name"] += str(function["name"])
                                yield {
                                    "type": "tool_call_name",
                                    "index": index,
                                    "id": slot["id"],
                                    "name": str(function["name"]),
                                }
                            arguments = function.get("arguments")
                            if isinstance(arguments, str) and arguments:
                                slot["arguments"] += arguments
                                yield {
                                    "type": "tool_call_args",
                                    "index": index,
                                    "delta": arguments,
                                }
        except asyncio.CancelledError:
            raise
        except ProviderError:
            raise
        except aiohttp.ClientError as exc:
            raise ProviderError(
                "连接模型服务失败，请检查网络", code="network", retryable=True
            ) from exc
        except asyncio.TimeoutError as exc:
            raise ProviderError(
                "模型响应超时，请稍后重试", code="timeout", retryable=True
            ) from exc

        tool_calls = []
        for index in sorted(calls):
            slot = calls[index]
            if not slot["id"]:
                slot["id"] = f"call_{index}"
            # arguments 保持模型输出的原始字符串，绝不重新序列化
            tool_calls.append(
                {
                    "id": slot["id"],
                    "type": "function",
                    "function": {"name": slot["name"], "arguments": slot["arguments"]},
                }
            )

        yield {
            "type": "done",
            "content": "".join(content),
            "reasoning": "".join(reasoning),
            "tool_calls": tool_calls,
            "finish_reason": finish_reason,
            "usage": usage or {},
        }

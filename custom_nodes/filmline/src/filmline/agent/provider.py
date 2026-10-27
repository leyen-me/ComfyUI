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
    def __init__(self, message: str, *, code: str = "provider_error", retryable: bool = False):
        super().__init__(message)
        self.code = code
        self.retryable = retryable


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
    ) -> dict[str, Any]:
        """按官方 OpenAI 格式组装请求；thinking 参数保持顶层（raw HTTP，不需要 extra_body）。"""
        settings = self._settings
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
        if settings.thinking != "auto":
            body["thinking"] = {"type": settings.thinking}
        if settings.thinking == "enabled":
            body["reasoning_effort"] = settings.reasoning_effort
        return body

    async def stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]],
    ) -> AsyncIterator[dict[str, Any]]:
        settings = self._settings
        if not settings.api_key:
            raise ProviderError("未配置模型 API Key", code="not_configured")

        body = self.request_body(messages, tools)
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
                        if response.status in (401, 403):
                            raise ProviderError(
                                "模型 API Key 无效或无权限", code="unauthorized"
                            )
                        if response.status == 429:
                            raise ProviderError(
                                "模型请求过多，请稍后重试", code="rate_limited", retryable=True
                            )
                        if response.status >= 500:
                            raise ProviderError(
                                "模型服务暂时不可用", code="upstream", retryable=True
                            )
                        raise ProviderError(
                            f"模型接口返回 HTTP {response.status}", code="bad_request"
                        )

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

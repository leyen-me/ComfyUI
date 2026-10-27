"""DeepSeek 账户余额查询（后端代理）。

官方接口：``GET /user/balance``，返回 ``is_available`` 与 ``balance_infos``。
余额是账户级数据，前端只通过本代理读取，API Key 不下发。

短 TTL 缓存用于吸收多标签页/连续刷新；每轮对话结束时前端会主动刷新一次。
"""

from __future__ import annotations

import asyncio
import hashlib
import time
from datetime import datetime, timezone
from typing import Any

import aiohttp

from ..config import AgentSettings, agent_settings
from ..errors import ServiceUnavailable

BALANCE_PATH = "/user/balance"
CACHE_TTL = 3.0
_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def balance_url(base_url: str) -> str:
    """base 可能带 /v1（OpenAI 兼容写法），余额接口在根路径。"""
    base = base_url.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return base + BALANCE_PATH


def _normalize(payload: dict[str, Any]) -> dict[str, Any]:
    items: list[dict[str, str]] = []
    raw_items = payload.get("balance_infos")
    if isinstance(raw_items, list):
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            currency = str(item.get("currency") or "")
            if currency not in ("CNY", "USD"):
                continue
            items.append(
                {
                    "currency": currency,
                    "total": str(item.get("total_balance") or "0"),
                    "granted": str(item.get("granted_balance") or "0"),
                    "topped_up": str(item.get("topped_up_balance") or "0"),
                }
            )
    return {
        "configured": True,
        "available": bool(payload.get("is_available")),
        "items": items,
        "fetched_at": datetime.now(timezone.utc)
        .isoformat(timespec="seconds")
        .replace("+00:00", "Z"),
    }


async def _get(settings: AgentSettings) -> dict[str, Any]:
    headers = {"Authorization": f"Bearer {settings.api_key}"}
    timeout = aiohttp.ClientTimeout(total=10)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(balance_url(settings.base_url), headers=headers) as response:
                if response.status == 200:
                    value = await response.json(content_type=None)
                    if not isinstance(value, dict):
                        raise ServiceUnavailable("余额接口返回格式异常")
                    return value
                if response.status in (401, 403):
                    raise ServiceUnavailable("DeepSeek API Key 无效或无权限")
                if response.status == 429:
                    raise ServiceUnavailable("余额查询过于频繁，请稍后重试")
                raise ServiceUnavailable("余额查询暂时不可用")
    except ServiceUnavailable:
        raise
    except asyncio.TimeoutError as exc:  # pragma: no cover - 网络超时
        raise ServiceUnavailable("余额查询超时") from exc
    except aiohttp.ClientError as exc:  # pragma: no cover - 网络错误
        raise ServiceUnavailable("连接余额服务失败") from exc


async def fetch_balance(
    settings: AgentSettings | None = None, *, force: bool = False
) -> dict[str, Any]:
    settings = settings or agent_settings()
    if not settings.api_key:
        return {"configured": False, "available": False, "items": [], "fetched_at": None}

    fingerprint = hashlib.sha256(settings.api_key.encode("utf-8")).hexdigest()[:12]
    key = f"{settings.base_url}|{fingerprint}"
    now = time.monotonic()
    if not force:
        cached = _cache.get(key)
        if cached is not None and now - cached[0] < CACHE_TTL:
            return cached[1]

    payload = await _get(settings)
    result = _normalize(payload)
    _cache[key] = (now, result)
    return result

"""采集 ComfyUI 的实时执行进度。

ComfyUI 的 ``progress`` / ``executing`` 事件只发给提交任务时使用的
``client_id``，因此每个 Filmline 任务用自己的 ``client_id`` 建一条 WebSocket。
进度只保存在内存里：任务结束即清理，进程重启后由 runner 重新连接。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import aiohttp

from .generation import COMFY_URL

_LOG = logging.getLogger("filmline")

# 节点类型 → 展示文案
_STAGE_BY_CLASS: dict[str, str] = {
    "UNETLoader": "加载模型",
    "CLIPLoader": "加载文本编码器",
    "VAELoader": "加载 VAE",
    "LoraLoaderModelOnly": "加载 LoRA",
    "FilmlineLoadImage": "读取参考图",
    "FilmlineLoadVideo": "读取参考视频",
    "FilmlineLoadAudio": "读取参考音频",
    "MiniMaxH3ReferenceToVideo": "编码参考",
    "MiniMaxH3ImageToVideo": "编码条件",
    "MiniMaxH3AddGuide": "锚定参考帧",
    "TextEncodeQwenImage21": "编码提示词",
    "ConditioningZeroOut": "准备条件",
    "KSampler": "采样",
    "SamplerCustomAdvanced": "采样",
    "VAEDecode": "解码",
    "VAEDecodeAudio": "解码音频",
    "CreateVideo": "封装视频",
    "SaveVideo": "保存视频",
    "SaveImage": "保存图片",
}


@dataclass
class ProgressState:
    value: int = 0
    max: int = 0
    node: str | None = None
    stage: str | None = None
    updated_at: float = 0.0


_progress: dict[int, ProgressState] = {}


def _stage(node: str | None, node_types: dict[str, str]) -> str | None:
    if not node:
        return None
    class_type = node_types.get(node)
    if class_type is None:
        return None
    return _STAGE_BY_CLASS.get(class_type, class_type)


def snapshot(task_id: int) -> dict[str, Any] | None:
    state = _progress.get(task_id)
    if state is None:
        return None
    percent = round(state.value / state.max * 100) if state.max > 0 else None
    return {
        "value": state.value,
        "max": state.max,
        "percent": percent,
        "node": state.node,
        "stage": state.stage,
        "updated_at": state.updated_at,
    }


def clear(task_id: int) -> None:
    _progress.pop(task_id, None)


async def watch(task_id: int, client_id: str, node_types: dict[str, str]) -> None:
    """连接该任务的 ComfyUI WebSocket，持续刷新进度直到被取消。"""
    if not client_id:
        return
    base = COMFY_URL.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://") :]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://") :]
    url = f"{base}/ws?clientId={quote(client_id)}"
    state = ProgressState(updated_at=time.time())
    _progress[task_id] = state
    backoff = 1.0

    while True:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.ws_connect(url, heartbeat=20) as ws:
                    backoff = 1.0
                    async for message in ws:
                        if message.type != aiohttp.WSMsgType.TEXT:
                            continue
                        try:
                            payload = json.loads(message.data)
                        except json.JSONDecodeError:
                            continue
                        kind = payload.get("type")
                        data = payload.get("data") or {}
                        if kind == "progress":
                            state.value = int(data.get("value") or 0)
                            state.max = int(data.get("max") or 0)
                            state.node = str(data.get("node") or "") or None
                            state.stage = _stage(state.node, node_types) or "采样"
                            state.updated_at = time.time()
                        elif kind == "executing":
                            node = data.get("node")
                            if node:
                                state.node = str(node)
                                state.stage = _stage(state.node, node_types)
                                state.updated_at = time.time()
                        elif kind in ("execution_start", "execution_cached"):
                            state.stage = "准备执行"
                            state.updated_at = time.time()
        except asyncio.CancelledError:
            raise
        except Exception:
            # ComfyUI 重启或网络抖动：保持最后进度，退避重连
            _LOG.debug("进度 WebSocket 断开，准备重连: task=%s", task_id, exc_info=True)
            await asyncio.sleep(backoff)
            backoff = min(5.0, backoff * 2)


async def stop(watcher: asyncio.Task[None] | None, task_id: int) -> None:
    if watcher is not None:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)
    clear(task_id)

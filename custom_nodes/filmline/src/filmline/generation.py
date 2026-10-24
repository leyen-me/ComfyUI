"""生成流程：把面板上的参数翻译成 ComfyUI API 工作流，跑完取回产物。

只通过 HTTP 调用本机 ComfyUI（``/prompt``、``/history``、``/view``），
不直接操作队列对象，便于将来把生成能力搬到独立进程。
"""

from __future__ import annotations

import asyncio
import logging
import os
import random
from dataclasses import dataclass
from typing import Any

import aiohttp

from .errors import AppError, InvalidArgument

_LOG = logging.getLogger("filmline")

COMFY_URL = os.environ.get("FILMLINE_COMFY_URL", "http://127.0.0.1:8188").rstrip("/")

# 尺寸：与模型原生分辨率保持同一量级，且都是 32 的倍数
IMAGE_SIZES: dict[str, tuple[int, int]] = {
    "16:9": (1344, 768),
    "9:16": (768, 1344),
    "1:1": (1024, 1024),
}
VIDEO_SIZES: dict[str, tuple[int, int]] = {
    "16:9": (1344, 768),
    "9:16": (768, 1344),
}
# 24fps，且需落在模型要求的 17k+5 网格上
VIDEO_DURATIONS: dict[int, int] = {5: 124, 10: 243}

IMAGE_MODEL = "qwen-image-2.1-Q6_K.gguf"
IMAGE_CLIP = "qwen3vl_8b_int8_convrot.safetensors"
IMAGE_VAE = "qwen_image_2.1_vae_bf16.safetensors"

VIDEO_MODEL = "minimax_h3_fl2va_pruned_fp8_scaled.safetensors"
VIDEO_CLIP = "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
VIDEO_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
VIDEO_LORA = "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"

# TextEncodeQwenImage21 声明 image_1…image_16，上限 16 张；
# 参考图越多采样越慢（每张都会作为 token 过每一步）
MAX_IMAGE_REFS = 16
MAX_VIDEO_REFS = 1

IMAGE_STEPS = 20
IMAGE_CFG = 4.0
IMAGE_SHIFT = 3.1
VIDEO_STEPS = 4
VIDEO_CFG = 1.0
VIDEO_FPS = 24


class GenerationFailed(AppError):
    code = "generation_failed"
    status = 502
    default_message = "生成失败"


@dataclass(frozen=True)
class Workflow:
    prompt: dict[str, Any]
    kind: str
    meta: dict[str, Any]


def _seed() -> int:
    return random.randint(0, 2**31 - 1)


def image_workflow(
    *,
    prompt: str,
    size: str,
    count: int,
    seed: int | None = None,
    refs: list[str] | None = None,
    prefix: str = "filmline/image",
) -> Workflow:
    if size not in IMAGE_SIZES:
        raise InvalidArgument(f"图片尺寸只支持: {', '.join(IMAGE_SIZES)}")
    if not 1 <= count <= 4:
        raise InvalidArgument("生成数量必须在 1-4 之间")
    if not prompt.strip():
        raise InvalidArgument("提示词不能为空")

    refs = refs or []
    if len(refs) > MAX_IMAGE_REFS:
        raise InvalidArgument(f"参考图最多 {MAX_IMAGE_REFS} 张")
    if refs and count != 1:
        raise InvalidArgument("带参考图时只能生成 1 张")

    width, height = IMAGE_SIZES[size]
    actual_seed = _seed() if seed is None else seed

    graph: dict[str, Any] = {
        "1": {"class_type": "UnetLoaderGGUF", "inputs": {"unet_name": IMAGE_MODEL}},
        "2": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": IMAGE_CLIP, "type": "qwen_image"},
        },
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": IMAGE_VAE}},
        "4": {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["1", 0], "shift": IMAGE_SHIFT},
        },
        "5": {
            "class_type": "TextEncodeQwenImage21",
            "inputs": {
                "clip": ["2", 0],
                "prompt": prompt,
                "negative_prompt": "",
                "resolution": max(width, height),
            },
        },
        "7": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["4", 0],
                "seed": actual_seed,
                "steps": IMAGE_STEPS,
                "cfg": IMAGE_CFG,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["5", 0],
                "negative": ["5", 1],
                "latent_image": None,  # 参考图/空 latent 差异见下方
                "denoise": 1.0,
            },
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["7", 0], "vae": ["3", 0]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"images": ["8", 0], "filename_prefix": prefix},
        },
    }

    if refs:
        # 有参考图时 latent 由编码节点按第一张参考图的尺寸产出
        for index, path in enumerate(refs, start=1):
            node_id = f"{9 + index}"
            graph[node_id] = {
                "class_type": "FilmlineLoadImage",
                "inputs": {"path": path},
            }
            graph["5"]["inputs"][f"images.image_{index}"] = [node_id, 0]
        latent_source = ["5", 2]
    else:
        graph["6"] = {
            "class_type": "FilmlineEmptyLatent",
            "inputs": {
                "model": ["4", 0],
                "width": width,
                "height": height,
                "batch_size": count,
            },
        }
        latent_source = ["6", 0]

    graph["7"]["inputs"]["latent_image"] = latent_source

    return Workflow(
        prompt=graph,
        kind="image",
        meta={
            "prompt": prompt,
            "size": size,
            "width": width,
            "height": height,
            "count": count,
            "seed": actual_seed,
            "model": IMAGE_MODEL,
            "steps": IMAGE_STEPS,
            "cfg": IMAGE_CFG,
            "refs": len(refs),
        },
    )


def video_workflow(
    *,
    prompt: str,
    size: str,
    duration: int,
    seed: int | None = None,
    refs: list[str] | None = None,
    prefix: str = "filmline/video",
) -> Workflow:
    if size not in VIDEO_SIZES:
        raise InvalidArgument(f"视频尺寸只支持: {', '.join(VIDEO_SIZES)}")
    if duration not in VIDEO_DURATIONS:
        raise InvalidArgument("视频时长只支持 5 或 10 秒")
    if not prompt.strip():
        raise InvalidArgument("提示词不能为空")

    refs = refs or []
    if len(refs) > 1:
        raise InvalidArgument("视频首帧只支持 1 张")

    width, height = VIDEO_SIZES[size]
    length = VIDEO_DURATIONS[duration]
    actual_seed = _seed() if seed is None else seed

    graph: dict[str, Any] = {
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": VIDEO_MODEL, "weight_dtype": "fp8_e4m3fn"},
        },
        "2": {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {"model": ["1", 0], "lora_name": VIDEO_LORA, "strength_model": 1.0},
        },
        "3": {
            "class_type": "MiniMaxH3SigmaShift",
            "inputs": {"model": ["2", 0], "shift_video": 12.0, "shift_audio": 3.0},
        },
        "4": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": VIDEO_CLIP, "type": "minimax"},
        },
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_VAE}},
        "6": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_AUDIO_VAE}},
        "7": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["4", 0],
                "vae": ["5", 0],
                "prompt": prompt,
                "width": width,
                "height": height,
                "length": length,
            },
        },
        "8": {
            "class_type": "ConditioningZeroOut",
            "inputs": {"conditioning": ["7", 0]},
        },
        "9": {
            "class_type": "KSampler",
            "inputs": {
                "model": ["3", 0],
                "seed": actual_seed,
                "steps": VIDEO_STEPS,
                "cfg": VIDEO_CFG,
                "sampler_name": "euler",
                "scheduler": "simple",
                "positive": ["7", 0],
                "negative": ["8", 0],
                "latent_image": ["7", 1],
                "denoise": 1.0,
            },
        },
        "10": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["9", 0], "vae": ["5", 0]},
        },
        "11": {
            "class_type": "VAEDecodeAudio",
            "inputs": {"samples": ["9", 0], "vae": ["6", 0]},
        },
        "12": {
            "class_type": "CreateVideo",
            "inputs": {"images": ["10", 0], "audio": ["11", 0], "fps": VIDEO_FPS},
        },
        "13": {
            "class_type": "SaveVideo",
            "inputs": {"video": ["12", 0], "filename_prefix": prefix, "format": "auto"},
        },
    }

    if refs:
        graph["14"] = {"class_type": "FilmlineLoadImage", "inputs": {"path": refs[0]}}
        graph["7"]["inputs"]["first_frame"] = ["14", 0]

    return Workflow(
        prompt=graph,
        kind="video",
        meta={
            "prompt": prompt,
            "size": size,
            "width": width,
            "height": height,
            "duration": duration,
            "frames": length,
            "seed": actual_seed,
            "model": VIDEO_MODEL,
            "lora": VIDEO_LORA,
            "steps": VIDEO_STEPS,
            "cfg": VIDEO_CFG,
            "refs": len(refs),
        },
    )


async def _submit(session: aiohttp.ClientSession, graph: dict[str, Any]) -> str:
    async with session.post(f"{COMFY_URL}/prompt", json={"prompt": graph}) as response:
        body = await response.json(content_type=None)
        if response.status != 200:
            error = body.get("error") if isinstance(body, dict) else body
            details = body.get("node_errors") if isinstance(body, dict) else None
            _LOG.error("提交工作流失败: %s %s", error, details)
            raise GenerationFailed(f"ComfyUI 拒绝工作流: {error or response.status}", details=details)
        return str(body["prompt_id"])


async def _wait(session: aiohttp.ClientSession, prompt_id: str, timeout: float) -> list[dict]:
    """轮询 /history 直到该任务完成，返回输出文件列表。"""
    deadline = asyncio.get_event_loop().time() + timeout
    while True:
        if asyncio.get_event_loop().time() > deadline:
            raise GenerationFailed("生成超时")

        async with session.get(f"{COMFY_URL}/history/{prompt_id}") as response:
            history = await response.json(content_type=None)

        entry = history.get(prompt_id) if isinstance(history, dict) else None
        if entry:
            status = entry.get("status") or {}
            if status.get("status_str") == "error":
                raise GenerationFailed("ComfyUI 执行失败", details=status.get("messages"))
            files: list[dict] = []
            for output in (entry.get("outputs") or {}).values():
                for value in output.values():
                    if isinstance(value, list):
                        files.extend(item for item in value if isinstance(item, dict) and "filename" in item)
            if files:
                return files

        await asyncio.sleep(1.5)


async def _download(session: aiohttp.ClientSession, item: dict) -> bytes:
    params = {
        "filename": item["filename"],
        "subfolder": item.get("subfolder", ""),
        "type": item.get("type", "output"),
    }
    async with session.get(f"{COMFY_URL}/view", params=params) as response:
        if response.status != 200:
            raise GenerationFailed(f"取回产物失败: {item['filename']}")
        return await response.read()


@dataclass(frozen=True)
class Product:
    filename: str
    suffix: str
    data: bytes


async def run(workflow: Workflow, *, timeout: float) -> list[Product]:
    """提交并等待完成，返回内存中的产物（由调用方落盘）。"""
    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(connector=connector) as session:
        prompt_id = await _submit(session, workflow.prompt)
        _LOG.info("生成任务已提交: %s (%s)", prompt_id, workflow.kind)
        files = await _wait(session, prompt_id, timeout)
        products = []
        for item in files:
            data = await _download(session, item)
            suffix = os.path.splitext(item["filename"])[1] or (
                ".png" if workflow.kind == "image" else ".mp4"
            )
            products.append(Product(filename=item["filename"], suffix=suffix, data=data))
        return products


def timeout_for(kind: str) -> float:
    return 1800.0 if kind == "video" else 900.0


def ratio_label(width: int, height: int) -> str:
    """按实际像素推断比例标签，带参考图时以产物为准。"""
    ratio = width / height if height else 0
    for label, target in (("16:9", 16 / 9), ("9:16", 9 / 16), ("1:1", 1.0)):
        if abs(ratio - target) / target < 0.04:
            return label
    return f"{width}:{height}"

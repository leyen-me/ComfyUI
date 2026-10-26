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

# 比例 + 分辨率档位共同决定像素：档位是「长边」，短边按比例推导并对齐 32
IMAGE_RATIOS: dict[str, tuple[int, int]] = {
    "16:9": (16, 9),
    "9:16": (9, 16),
    "1:1": (1, 1),
}
# 档位尺寸对齐官方给出的原生比例表（Qwen-Image-2.1：2K 为原生，
# 16:9 = 2752×1536、1:1 = 2048×2048）；1K 取其一半。
# 不提供 4K：超出官方支持范围（原生 2K），容易糊且耗时数倍
IMAGE_TIERS: dict[str, dict[str, tuple[int, int]]] = {
    "1k": {"16:9": (1376, 768), "9:16": (768, 1376), "1:1": (1024, 1024)},
    "2k": {"16:9": (2752, 1536), "9:16": (1536, 2752), "1:1": (2048, 2048)},
}
# 视频分辨率档位，对齐官方 ResolutionSelector：
# - 0.4 MP 草稿档（16:9 = 864×480）
# - 768 原生档（短边 768，上限 768×1344）
# 官方文档明确「离 1MP 越远质量越差」，因此只提供这两档，不做 2K 直出。
VIDEO_TIERS: dict[str, dict[str, tuple[int, int]]] = {
    "0.4": {"16:9": (864, 480), "9:16": (480, 864), "1:1": (640, 640)},
    "768": {"16:9": (1344, 768), "9:16": (768, 1344), "1:1": (992, 992)},
}
DEFAULT_VIDEO_TIER = "768"
# 24fps，帧数必须落在模型要求的 17k+5 网格上（向上对齐）。
# 本地节点训练区间是 124–362 帧（≈5.2–15.1 秒），超出部分属于未验证区域。
VIDEO_FPS = 24
VIDEO_MIN_SECONDS = 5
VIDEO_MAX_SECONDS = 15
VIDEO_MIN_FRAMES = 124
VIDEO_MAX_FRAMES = 362


def align_frames(frames: int) -> int:
    """向上对齐到 H3 的 17k+5 帧网格（5、22、39 …）。"""
    while frames % 17 != 5:
        frames += 1
    return frames


def video_length(duration: float) -> int:
    """秒数 → 对齐到 17k+5 网格的帧数（向上取整到网格）。

    允许浮点秒（按参考音频自动定时长时会得到小数）；范围仍是训练区间。
    """
    if isinstance(duration, bool) or not isinstance(duration, (int, float)):
        raise InvalidArgument("视频时长必须是数字")
    if not VIDEO_MIN_SECONDS <= duration <= VIDEO_MAX_SECONDS:
        raise InvalidArgument(
            f"视频时长只支持 {VIDEO_MIN_SECONDS}–{VIDEO_MAX_SECONDS} 秒"
        )
    return align_frames(round(float(duration) * VIDEO_FPS))

IMAGE_MODEL = "qwen-image-2.1-Q6_K.gguf"
IMAGE_CLIP = "qwen3vl_8b_int8_convrot.safetensors"
IMAGE_VAE = "qwen_image_2.1_vae_bf16.safetensors"

VIDEO_MODEL = "minimax_h3_fl2va_pruned_fp8_scaled.safetensors"
VIDEO_CLIP = "qwen3vl_32b_minimax_h3_int8_convrot.safetensors"
VIDEO_VAE = "minimax_h3_video_vae_fp16.safetensors"
VIDEO_AUDIO_VAE = "minimax_h3_audio_vae_fp32.safetensors"
VIDEO_LORA = "minimax_h3_fl2v_turbo_4step_v1.0_768p_comfyui_bf16.safetensors"

# Ref2VA 是另一套权重：参考图/视频/音频不会锁定首帧。
# 官方模型卡：能用 int8_convrot 就优先用（本机 torch cu130 + Ada 满足条件），
# fp8_scaled 只是退路。保留环境变量便于显存不足时回退。
VIDEO_REF_MODEL = os.environ.get(
    "FILMLINE_REF_UNET", "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
)
REF_MODEL_INT8 = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
REF_MODEL_FP8 = "minimax_h3_ref2va_pruned_fp8_scaled.safetensors"
VIDEO_REF_LORA = "minimax_h3_ref2v_turbo_8step_v1.1_768p_comfyui_bf16.safetensors"
# 参考 token 会参与每一步采样，step 太少时身份/口型/音色都锁不住。
# 官方建议：想要紧参考就关掉 turbo 并往 25 步加；语音/音色至少 12 步。
REF_QUALITY_PRESETS: dict[str, dict[str, object]] = {
    "quality": {"steps": 20, "lora": None, "lora_strength": 0.0},
    "fast": {"steps": 8, "lora": VIDEO_REF_LORA, "lora_strength": 0.7},
}
DEFAULT_REF_QUALITY = "quality"
# 官方模板注：参考重的提示词 beta/normal 往往优于 simple；先保留可切换。
REF_SCHEDULERS = ("simple", "beta", "normal")
VIDEO_REF_SCHEDULER = os.environ.get("FILMLINE_REF_SCHEDULER", "simple")
# 参考视频解码短边；显存吃紧时可降到 512（官方为 768）
REF_VIDEO_SHORT_EDGE = int(os.environ.get("FILMLINE_REF_SHORT_EDGE", "768"))

# 官方说明：参考图最多 10 张（image_1…image_10），image_1 是编辑目标
MAX_IMAGE_REFS = 10
# H3 Ref2VA：参考图 ≤9、视频 ≤3、音频 ≤3，所有文件合计 ≤12
MAX_VIDEO_REFS = 9
MAX_VIDEO_VIDEOS = 3
MAX_VIDEO_AUDIOS = 3
MAX_VIDEO_FILES = 12
# 官方 Add Guide 可链式叠加；这里限制 4 个，避免参考 token/耗时失控
MAX_VIDEO_GUIDES = 4

# 官方参数：cfg 固定 1（不用负面提示词），euler/simple，步数 40-50；
# 这里取 30 兼顾质量与速度
IMAGE_STEPS = 30
IMAGE_CFG = 1.0
IMAGE_SHIFT = 3.1
# 官方模板：SamplerCustomAdvanced + res_multistep + BasicScheduler(simple)
# 这里用 KSampler 等价表达（cfg 1.0 等价于 BasicGuider）
VIDEO_STEPS = 4
VIDEO_CFG = 1.0
VIDEO_SAMPLER = "res_multistep"
VIDEO_SCHEDULER = "simple"
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


@dataclass(frozen=True)
class VideoReference:
    path: str
    use_audio: bool = False
    trim_start: float = 0.0
    trim_end: float = 0.0


@dataclass(frozen=True)
class GuideFrame:
    """把一张参考图锚定到输出时间轴的指定帧（官方 Add Guide）。"""

    path: str
    frame_index: int


def _seed() -> int:
    return random.randint(0, 2**31 - 1)


def resolve_ref_model() -> str:
    """选择 Ref2VA UNet：优先官方 int8_convrot，文件缺失时回退 fp8。

    显式设置 ``FILMLINE_REF_UNET`` 时完全尊重用户选择，不做回退。
    """
    override = os.environ.get("FILMLINE_REF_UNET")
    if override:
        return override
    try:
        import folder_paths  # ComfyUI 运行时模块；单测环境不存在

        roots = folder_paths.get_folder_paths("diffusion_models")
    except Exception:
        return VIDEO_REF_MODEL
    # 直接看文件，避免 folder_paths 的目录缓存还没刷新
    if any(os.path.isfile(os.path.join(root, REF_MODEL_INT8)) for root in roots):
        return REF_MODEL_INT8
    _LOG.warning("未找到 %s，回退到 %s", REF_MODEL_INT8, REF_MODEL_FP8)
    return REF_MODEL_FP8


def image_dimensions(size: str, tier: str) -> tuple[int, int]:
    """由比例与档位查表得到像素（对齐官方原生比例表）。"""
    if size not in IMAGE_RATIOS:
        raise InvalidArgument(f"图片比例只支持: {', '.join(IMAGE_RATIOS)}")
    if tier not in IMAGE_TIERS:
        raise InvalidArgument(f"分辨率只支持: {', '.join(IMAGE_TIERS)}")
    return IMAGE_TIERS[tier][size]


def video_dimensions(size: str, tier: str) -> tuple[int, int]:
    if tier not in VIDEO_TIERS:
        raise InvalidArgument(f"视频分辨率只支持: {', '.join(VIDEO_TIERS)}")
    if size not in VIDEO_TIERS[tier]:
        raise InvalidArgument(f"视频比例只支持: {', '.join(VIDEO_TIERS[tier])}")
    return VIDEO_TIERS[tier][size]


def image_workflow(
    *,
    prompt: str,
    size: str,
    count: int,
    tier: str = "1k",
    seed: int | None = None,
    refs: list[str] | None = None,
    prefix: str = "filmline/image",
) -> Workflow:
    if not 1 <= count <= 4:
        raise InvalidArgument("生成数量必须在 1-4 之间")
    if not prompt.strip():
        raise InvalidArgument("提示词不能为空")

    refs = refs or []
    if len(refs) > MAX_IMAGE_REFS:
        raise InvalidArgument(f"参考图最多 {MAX_IMAGE_REFS} 张")
    if refs and count != 1:
        raise InvalidArgument("带参考图时只能生成 1 张")

    width, height = image_dimensions(size, tier)
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
                # 无参考图时按所选尺寸的较长边作为参考分辨率；
                # 有参考图时必须为 0，保持原图像素，否则尺寸变化会让编辑漂移
                # 该参数上限 4096（ComfyUI 节点定义），仅作参考图缩放预算
                "resolution": 0 if refs else min(4096, max(width, height)),
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
        # 参考图必须接 vae，否则只作为视觉条件、不进入采样序列
        graph["5"]["inputs"]["vae"] = ["3", 0]
        # 参考图先按目标比例居中裁切缩放：素材适配输出，而不是输出迁就素材。
        # 这样画布始终等于所选尺寸，同时参考图与画布比例一致，避免编辑漂移。
        for index, path in enumerate(refs, start=1):
            loader_id = f"{10 + index}"
            scale_id = f"{30 + index}"
            graph[loader_id] = {
                "class_type": "FilmlineLoadImage",
                "inputs": {"path": path},
            }
            graph[scale_id] = {
                "class_type": "ImageScale",
                "inputs": {
                    "image": [loader_id, 0],
                    "upscale_method": "lanczos",
                    "width": width,
                    "height": height,
                    "crop": "center",
                },
            }
            graph["5"]["inputs"][f"images.image_{index}"] = [scale_id, 0]
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
            "tier": tier,
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
    tier: str = "768",
    seed: int | None = None,
    first_frame: str | None = None,
    last_frame: str | None = None,
    refs: list[str] | None = None,
    prefix: str = "filmline/video",
) -> Workflow:
    if tier not in VIDEO_TIERS:
        raise InvalidArgument(f"视频分辨率只支持: {', '.join(VIDEO_TIERS)}")
    if size not in VIDEO_TIERS[tier]:
        raise InvalidArgument(f"视频比例只支持: {', '.join(VIDEO_TIERS[tier])}")
    length = video_length(duration)
    if not prompt.strip():
        raise InvalidArgument("提示词不能为空")

    # 旧调用方（以及旧测试）通过 refs 传一张首帧，这里保持兼容
    if refs:
        if first_frame or last_frame:
            raise InvalidArgument("refs 与 first_frame / last_frame 不能同时使用")
        if len(refs) > 1:
            raise InvalidArgument("视频首帧只支持 1 张")
        first_frame = refs[0]

    width, height = video_dimensions(size, tier)
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
                "sampler_name": VIDEO_SAMPLER,
                "scheduler": VIDEO_SCHEDULER,
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

    if first_frame or last_frame:
        # 首帧与尾帧都按画布居中裁切：官方首帧是拉伸填满，非等比例会变形；
        # 这里选择裁切以保持画面不变形，前端会明确提示比例不一致。
        if first_frame:
            graph["14"] = {"class_type": "FilmlineLoadImage", "inputs": {"path": first_frame}}
            graph["15"] = {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["14", 0],
                    "upscale_method": "lanczos",
                    "width": width,
                    "height": height,
                    "crop": "center",
                },
            }
            graph["7"]["inputs"]["first_frame"] = ["15", 0]
        if last_frame:
            graph["16"] = {"class_type": "FilmlineLoadImage", "inputs": {"path": last_frame}}
            graph["17"] = {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["16", 0],
                    "upscale_method": "lanczos",
                    "width": width,
                    "height": height,
                    "crop": "center",
                },
            }
            graph["7"]["inputs"]["last_frame"] = ["17", 0]

    frames = int(bool(first_frame)) + int(bool(last_frame))
    return Workflow(
        prompt=graph,
        kind="video",
        meta={
            "prompt": prompt,
            "size": size,
            "tier": tier,
            "width": width,
            "height": height,
            "duration": duration,
            "frames": length,
            "fps": VIDEO_FPS,
            "has_audio": True,
            "seed": actual_seed,
            "model": VIDEO_MODEL,
            "lora": VIDEO_LORA,
            "steps": VIDEO_STEPS,
            "cfg": VIDEO_CFG,
            "refs": frames,
        },
    )


def video_reference_workflow(
    *,
    prompt: str,
    size: str,
    duration: float,
    tier: str = DEFAULT_VIDEO_TIER,
    seed: int | None = None,
    refs: list[str] | None = None,
    ref_videos: list[VideoReference] | None = None,
    ref_audios: list[str] | None = None,
    ref_image_size: str = "match",
    quality: str = DEFAULT_REF_QUALITY,
    scheduler: str | None = None,
    guides: list[GuideFrame] | None = None,
    prefix: str = "filmline/video",
) -> Workflow:
    """Ref2VA：参考图/视频/音频保持身份、风格、动作或音色。

    参考素材只做语义条件，不锁定第 0 帧；构图与起幅交给首尾帧模式。

    参考顺序决定提示词里的 ``<Picture i>`` / ``<Video k>`` / ``<Audio j>``：
    图片按传入顺序，视频按传入顺序，独立音频排在所有视频音轨之后。

    ``quality`` 决定采样档位：``quality`` 为官方基线（20 步、不挂 LoRA），
    ``fast`` 为 8 步 + turbo LoRA 0.7。参考 token 会参与每一步采样，
    step 过少时身份、口型与音色都锁不住，所以默认走质量档。
    """
    width, height = video_dimensions(size, tier)
    length = video_length(duration)
    if not prompt.strip():
        raise InvalidArgument("提示词不能为空")
    if ref_image_size not in ("match", "max"):
        raise InvalidArgument("ref_image_size 只支持 match / max")
    if quality not in REF_QUALITY_PRESETS:
        raise InvalidArgument(f"参考画质只支持: {', '.join(REF_QUALITY_PRESETS)}")
    actual_scheduler = scheduler or VIDEO_REF_SCHEDULER
    if actual_scheduler not in REF_SCHEDULERS:
        raise InvalidArgument(f"采样调度只支持: {', '.join(REF_SCHEDULERS)}")

    refs = refs or []
    ref_videos = ref_videos or []
    ref_audios = ref_audios or []
    guides = guides or []
    if len(refs) > MAX_VIDEO_REFS:
        raise InvalidArgument(f"参考图最多 {MAX_VIDEO_REFS} 张")
    if len(ref_videos) > MAX_VIDEO_VIDEOS:
        raise InvalidArgument(f"参考视频最多 {MAX_VIDEO_VIDEOS} 段")
    if len(ref_audios) > MAX_VIDEO_AUDIOS:
        raise InvalidArgument(f"参考音频最多 {MAX_VIDEO_AUDIOS} 段")
    if len(refs) + len(ref_videos) + len(ref_audios) > MAX_VIDEO_FILES:
        raise InvalidArgument(f"参考素材合计最多 {MAX_VIDEO_FILES} 个")
    if guides and len(guides) > MAX_VIDEO_GUIDES:
        raise InvalidArgument(f"帧锚定最多 {MAX_VIDEO_GUIDES} 个")
    # 官方 Ref2VA 的视觉锚点来自图片/视频；只有独立音频时参考基本不生效
    if not refs and not ref_videos:
        raise InvalidArgument("参考生成至少需要 1 张参考图或 1 段参考视频")

    preset = REF_QUALITY_PRESETS[quality]
    steps = int(preset["steps"])
    lora_name = preset["lora"]
    lora_strength = float(preset["lora_strength"])
    actual_seed = _seed() if seed is None else seed
    ref_model = resolve_ref_model()

    ref_images: dict[str, list[Any]] = {}
    video_frames: dict[str, list[Any]] = {}
    video_audios: dict[str, list[Any]] = {}
    audio_refs: dict[str, list[Any]] = {}
    graph: dict[str, Any] = {
        # int8_convrot / fp8_scaled 都交给 ComfyUI 按 checkpoint 自行识别量化
        "1": {
            "class_type": "UNETLoader",
            "inputs": {"unet_name": ref_model, "weight_dtype": "default"},
        },
        "4": {
            "class_type": "CLIPLoader",
            "inputs": {"clip_name": VIDEO_CLIP, "type": "minimax"},
        },
        "5": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_VAE}},
        "6": {"class_type": "VAELoader", "inputs": {"vae_name": VIDEO_AUDIO_VAE}},
        "7": {
            "class_type": "MiniMaxH3ReferenceToVideo",
            "inputs": {
                "clip": ["4", 0],
                "vae": ["5", 0],
                "audio_vae": ["6", 0],
                "prompt": prompt,
                "width": width,
                "height": height,
                "length": length,
                "ref_image_size": ref_image_size,
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
                "steps": steps,
                "cfg": VIDEO_CFG,
                "sampler_name": VIDEO_SAMPLER,
                "scheduler": actual_scheduler,
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

    model_source = ["1", 0]
    if lora_name:
        graph["2"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["1", 0],
                "lora_name": lora_name,
                "strength_model": lora_strength,
            },
        }
        model_source = ["2", 0]
    # 显式写入 shift，值与模型定义默认一致（12 / 3）；FastH3 等变体可另配
    graph["3"] = {
        "class_type": "MiniMaxH3SigmaShift",
        "inputs": {"model": model_source, "shift_video": 12.0, "shift_audio": 3.0},
    }

    # 参考素材不做画布裁切：让 Ref2VA 自己按 ref_image_size 等比缩放，保留完整构图
    next_node = 14
    for index, path in enumerate(refs):
        node_id = str(next_node)
        next_node += 1
        graph[node_id] = {"class_type": "FilmlineLoadImage", "inputs": {"path": path}}
        ref_images[f"ref_image_{index}"] = [node_id, 0]

    for index, video in enumerate(ref_videos):
        node_id = str(next_node)
        next_node += 1
        graph[node_id] = {
            "class_type": "FilmlineLoadVideo",
            "inputs": {
                "path": video.path,
                # 官方节点会把参考视频缩到 768 短边；不要提前压到 512
                "short_edge": REF_VIDEO_SHORT_EDGE,
                "require_audio": video.use_audio,
                "trim_start": float(video.trim_start),
                "trim_end": float(video.trim_end),
            },
        }
        video_frames[f"ref_video_{index}"] = [node_id, 0]
        if video.use_audio:
            video_audios[f"ref_video_audio_{index}"] = [node_id, 1]

    for index, path in enumerate(ref_audios):
        node_id = str(next_node)
        next_node += 1
        graph[node_id] = {
            "class_type": "FilmlineLoadAudio",
            # 0 表示不截断：官方不对独立音频设上限
            "inputs": {"path": path, "max_seconds": 0.0},
        }
        audio_refs[f"ref_audio_{index}"] = [node_id, 0]

    # Add Guide：把参考图钉到输出时间轴的具体帧，链在 Ref2VA 的 positive 之后
    positive: list[Any] = ["7", 0]
    for index, guide in enumerate(guides):
        if not 0 <= guide.frame_index < length:
            raise InvalidArgument(
                f"第 {index + 1} 个帧锚定超出视频长度（0–{length - 1} 帧）"
            )
        loader_id = str(100 + index)
        guide_id = str(110 + index)
        graph[loader_id] = {
            "class_type": "FilmlineLoadImage",
            "inputs": {"path": guide.path},
        }
        graph[guide_id] = {
            "class_type": "MiniMaxH3AddGuide",
            "inputs": {
                "positive": positive,
                "vae": ["5", 0],
                "latent": ["7", 1],
                "image": [loader_id, 0],
                "frame_idx": int(guide.frame_index),
            },
        }
        positive = [guide_id, 0]
    if guides:
        graph["9"]["inputs"]["positive"] = positive

    if ref_images:
        graph["7"]["inputs"]["ref_images"] = ref_images
    if video_frames:
        graph["7"]["inputs"]["ref_videos"] = video_frames
    if video_audios:
        graph["7"]["inputs"]["ref_video_audios"] = video_audios
    if audio_refs:
        graph["7"]["inputs"]["ref_audios"] = audio_refs

    return Workflow(
        prompt=graph,
        kind="video",
        meta={
            "prompt": prompt,
            "size": size,
            "tier": tier,
            "width": width,
            "height": height,
            "duration": duration,
            "frames": length,
            "fps": VIDEO_FPS,
            "has_audio": True,
            "seed": actual_seed,
            "model": ref_model,
            "lora": lora_name,
            "lora_strength": lora_strength,
            "quality": quality,
            "steps": steps,
            "scheduler": actual_scheduler,
            "cfg": VIDEO_CFG,
            "refs": len(refs),
            "ref_videos": len(ref_videos),
            "ref_audios": len(ref_audios),
            "ref_image_size": ref_image_size,
            "ref_video_trims": [
                [video.trim_start, video.trim_end] for video in ref_videos
            ],
            "ref_guides": [
                {"frame_index": guide.frame_index} for guide in guides
            ],
        },
    )


async def _submit(
    session: aiohttp.ClientSession, graph: dict[str, Any], *, client_id: str | None = None
) -> str:
    payload: dict[str, Any] = {"prompt": graph}
    if client_id:
        payload["client_id"] = client_id
    async with session.post(f"{COMFY_URL}/prompt", json=payload) as response:
        body = await response.json(content_type=None)
        if response.status != 200:
            error = body.get("error") if isinstance(body, dict) else body
            details = body.get("node_errors") if isinstance(body, dict) else None
            _LOG.error("提交工作流失败: %s %s", error, details)
            raise GenerationFailed(f"ComfyUI 拒绝工作流: {error or response.status}", details=details)
        return str(body["prompt_id"])


@dataclass(frozen=True)
class QueuedPrompt:
    prompt_id: str
    graph: dict[str, Any]
    extra_data: dict[str, Any]


def _queue_entry(item: Any) -> QueuedPrompt | None:
    if not isinstance(item, (list, tuple)) or len(item) < 3:
        return None
    prompt_id = str(item[1] or "")
    graph = item[2] if isinstance(item[2], dict) else {}
    extra = item[3] if len(item) > 3 and isinstance(item[3], dict) else {}
    if not prompt_id:
        return None
    return QueuedPrompt(prompt_id=prompt_id, graph=graph, extra_data=extra)


async def cancel(prompt_id: str) -> bool:
    """取消 ComfyUI 的排队/运行任务；返回 ComfyUI 是否真的取消了它。

    优先用 ComfyUI 的原子取消接口；旧版本回退到 delete queue + 定向 interrupt。
    """
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{COMFY_URL}/api/jobs/{prompt_id}/cancel"
            ) as response:
                if response.status == 200:
                    body = await response.json(content_type=None)
                    return bool((body or {}).get("cancelled"))
                if response.status not in (404, 405):
                    _LOG.warning("取消任务失败: HTTP %s", response.status)
                    return False

            # 兼容没有 /api/jobs/{id}/cancel 的 ComfyUI
            async with session.post(
                f"{COMFY_URL}/queue", json={"delete": [prompt_id]}
            ) as response:
                await response.read()
            async with session.post(
                f"{COMFY_URL}/interrupt", json={"prompt_id": prompt_id}
            ) as response:
                await response.read()
            return True
    except Exception:
        _LOG.warning("取消 ComfyUI 任务失败", exc_info=True)
        return False


async def queue_snapshot() -> tuple[list[QueuedPrompt], list[QueuedPrompt]]:
    """读取 ComfyUI 当前队列（运行中 + 排队），用于任务面板合并外部任务。"""
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{COMFY_URL}/queue") as response:
                if response.status != 200:
                    return [], []
                data = await response.json(content_type=None)
    except Exception:
        _LOG.warning("读取 ComfyUI 队列失败", exc_info=True)
        return [], []

    running = [
        entry
        for item in (data.get("queue_running") or [])
        if (entry := _queue_entry(item)) is not None
    ]
    pending = [
        entry
        for item in (data.get("queue_pending") or [])
        if (entry := _queue_entry(item)) is not None
    ]
    return running, pending


async def _wait(
    session: aiohttp.ClientSession, prompt_id: str, timeout: float
) -> tuple[list[dict], float | None]:
    """轮询 /history 直到完成，返回（输出文件, 纯执行秒数）。

    执行秒数取 ComfyUI 的 execution_start → execution_success，
    不含排队等待，避免统计被前一个任务干扰。每几轮同时看 /queue，
    如果任务既不在队列也没有 history，说明 ComfyUI 重启或任务丢失。
    """
    deadline = asyncio.get_event_loop().time() + timeout
    polls = 0
    missing = 0
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
                return files, _execution_seconds(status)

        polls += 1
        if polls % 4 == 0:
            try:
                async with session.get(f"{COMFY_URL}/queue") as response:
                    queue = await response.json(content_type=None) if response.status == 200 else {}
            except Exception:
                queue = {}
            if isinstance(queue, dict):
                ids = {
                    str(item[1])
                    for key in ("queue_running", "queue_pending")
                    for item in (queue.get(key) or [])
                    if isinstance(item, (list, tuple)) and len(item) > 1
                }
                if prompt_id in ids:
                    missing = 0
                elif queue:
                    missing += 1
                    if missing >= 3:
                        raise GenerationFailed("ComfyUI 任务已丢失或服务已重启")
            else:
                missing = 0

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


async def run(workflow: Workflow, *, timeout: float) -> tuple[list[Product], float | None]:
    """提交并等待完成，返回（产物, 纯执行秒数）。"""
    prompt_id = await submit(workflow)
    return await collect(prompt_id, kind=workflow.kind, timeout=timeout)


async def submit(workflow: Workflow, *, client_id: str | None = None) -> str:
    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(connector=connector) as session:
        prompt_id = await _submit(session, workflow.prompt, client_id=client_id)
        _LOG.info("生成任务已提交: %s (%s)", prompt_id, workflow.kind)
        return prompt_id


async def collect(
    prompt_id: str, *, kind: str, timeout: float
) -> tuple[list[Product], float | None]:
    connector = aiohttp.TCPConnector(limit=4)
    async with aiohttp.ClientSession(connector=connector) as session:
        files, exec_seconds = await _wait(session, prompt_id, timeout)
        products = []
        for item in files:
            data = await _download(session, item)
            suffix = os.path.splitext(item["filename"])[1] or (
                ".png" if kind == "image" else ".mp4"
            )
            products.append(Product(filename=item["filename"], suffix=suffix, data=data))
        return products, exec_seconds


def timeout_for(kind: str) -> float:
    return 1800.0 if kind == "video" else 900.0


def ratio_label(width: int, height: int) -> str:
    """按实际像素推断比例标签，带参考图时以产物为准。"""
    ratio = width / height if height else 0
    for label, target in (("16:9", 16 / 9), ("9:16", 9 / 16), ("1:1", 1.0)):
        if abs(ratio - target) / target < 0.04:
            return label
    return f"{width}:{height}"


def _execution_seconds(status: dict) -> float | None:
    """从 history 的 status.messages 里取真实执行时长（毫秒时间戳）。"""
    stamps: dict[str, float] = {}
    for message in status.get("messages") or []:
        if not isinstance(message, (list, tuple)) or len(message) < 2:
            continue
        name, payload = message[0], message[1]
        if name in ("execution_start", "execution_success") and isinstance(payload, dict):
            timestamp = payload.get("timestamp")
            if isinstance(timestamp, (int, float)):
                stamps[name] = float(timestamp)

    start, end = stamps.get("execution_start"), stamps.get("execution_success")
    if start is None or end is None or end < start:
        return None
    return (end - start) / 1000.0

"""生成流程需要的辅助节点。

ComfyUI 自带的空 latent 节点都是固定通道数（`EmptyLatentImage` 固定 4 通道），
而 Qwen-Image 2.1 使用 64 通道 latent，其官方文本编码节点只能产出
``resolution × resolution`` 的正方形空 latent。为了按 16:9 / 9:16 出图，
这里补一个按模型 latent 格式生成任意尺寸空 latent 的节点。
"""

from __future__ import annotations

import torch

import comfy.model_management


class FilmlineEmptyLatent:
    """按任意宽高创建空 latent，通道数与降采样率取自模型自身的 latent 格式。"""

    CATEGORY = "filmline"
    FUNCTION = "generate"
    RETURN_TYPES = ("LATENT",)
    RETURN_NAMES = ("LATENT",)
    DESCRIPTION = "任意尺寸的空 latent，通道数由模型决定（供 Qwen-Image 等非 4 通道模型使用）。"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "width": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 16}),
                "height": ("INT", {"default": 1024, "min": 64, "max": 8192, "step": 16}),
                "batch_size": ("INT", {"default": 1, "min": 1, "max": 16}),
            }
        }

    def generate(self, model, width, height, batch_size=1):
        base = getattr(model, "model", model)
        latent_format = getattr(base, "latent_format", None)

        channels = getattr(latent_format, "latent_channels", 4) or 4
        ratio = getattr(latent_format, "spacial_downscale_ratio", 8) or 8

        latent = torch.zeros(
            [batch_size, channels, height // ratio, width // ratio],
            device=comfy.model_management.intermediate_device(),
            dtype=comfy.model_management.intermediate_dtype(),
        )
        return ({"samples": latent},)


NODE_CLASS_MAPPINGS = {"FilmlineEmptyLatent": FilmlineEmptyLatent}

NODE_DISPLAY_NAME_MAPPINGS = {"FilmlineEmptyLatent": "Filmline 空 Latent（任意尺寸）"}

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


class FilmlineLoadImage:
    """从本扩展的资产目录读取图片，供参考图 / 首帧使用。

    ``path`` 是相对 ``data/assets`` 的路径，由后端校验后传入，避免图生图时
    把文件复制进 ComfyUI 的 input 目录。
    """

    CATEGORY = "filmline"
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "MASK")
    RETURN_NAMES = ("IMAGE", "MASK")
    DESCRIPTION = "读取 Filmline 资产文件作为参考图或首帧。"

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"path": ("STRING", {"default": "", "multiline": False})}}

    def load(self, path):
        import numpy as np
        from PIL import Image, ImageOps, ImageSequence

        from .. import storage

        target = storage.resolve(path)
        if not target.is_file():
            raise FileNotFoundError(f"资产文件不存在: {path}")

        dtype = comfy.model_management.intermediate_dtype()
        device = comfy.model_management.intermediate_device()

        images = []
        masks = []
        with Image.open(target) as source:
            for frame in ImageSequence.Iterator(source):
                frame = ImageOps.exif_transpose(frame)
                has_alpha = frame.mode in ("RGBA", "LA") or (
                    frame.mode == "P" and "transparency" in frame.info
                )
                rgba = frame.convert("RGBA")
                rgb = np.array(rgba.convert("RGB")).astype(np.float32) / 255.0
                images.append(torch.from_numpy(rgb)[None,])
                if has_alpha:
                    alpha = np.array(rgba.getchannel("A")).astype(np.float32) / 255.0
                    masks.append(torch.from_numpy(1.0 - alpha)[None,])

        if not images:
            raise ValueError(f"无法读取图片: {path}")

        image = torch.cat(images, dim=0).to(device=device, dtype=dtype)
        if masks:
            mask = torch.cat(masks, dim=0).to(device=device, dtype=dtype)
        else:
            mask = torch.zeros((image.shape[0], 64, 64), dtype=dtype, device=device)
        return (image, mask)


class FilmlineLoadVideo:
    """读取视频资产，按 24fps 重采样并限制时长，供 H3 Ref2VA 使用。

    参考视频会整段进入 VAE，显存占用远高于首帧；这里默认把短边压到 512，
    并在输出时长处截断（5 秒输出只读 5 秒参考），避免无谓的长视频开销。
    """

    CATEGORY = "filmline"
    FUNCTION = "load"
    RETURN_TYPES = ("IMAGE", "AUDIO")
    RETURN_NAMES = ("frames", "audio")
    DESCRIPTION = "读取 Filmline 视频资产，重采样到 24fps 并截断时长。"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "path": ("STRING", {"default": "", "multiline": False}),
                "max_seconds": (
                    "FLOAT",
                    {"default": 15.0, "min": 0.1, "max": 15.0, "step": 0.1},
                ),
                "short_edge": ("INT", {"default": 512, "min": 32, "max": 2048, "step": 32}),
                "require_audio": ("BOOLEAN", {"default": False}),
            }
        }

    def load(self, path, max_seconds=15.0, short_edge=512, require_audio=False):
        import av
        import numpy as np
        import torch

        import comfy.model_management
        import comfy.utils
        from .. import media, storage

        target = storage.resolve(path)
        if not target.is_file():
            raise FileNotFoundError(f"资产文件不存在: {path}")

        info = media.probe(target)
        if info.duration < 1.95:
            raise ValueError("参考视频至少需要 2 秒")
        if require_audio and not info.has_audio:
            raise ValueError("该参考视频没有音轨")

        duration = min(float(max_seconds), info.duration)
        frame_count = max(5, min(360, int(round(duration * 24))))
        targets = [index / 24 for index in range(frame_count)]

        dtype = comfy.model_management.intermediate_dtype()
        device = comfy.model_management.intermediate_device()

        frames = []
        last = None
        width = height = None
        with av.open(str(target)) as container:
            stream = container.streams.video[0] if container.streams.video else None
            if stream is None:
                raise ValueError("参考视频不包含视频流")
            source_fps = float(stream.average_rate) if stream.average_rate else 24.0

            for frame_index, frame in enumerate(container.decode(stream)):
                time = (
                    float(frame.time)
                    if frame.time is not None
                    else float(frame.pts * stream.time_base)
                    if frame.pts is not None and stream.time_base is not None
                    else frame_index / source_fps
                )
                if time > duration + 1e-6:
                    break
                array = frame.to_ndarray(format="rgb24")
                last = array
                if width is None:
                    source_h, source_w = array.shape[:2]
                    scale = min(1.0, float(short_edge) / max(1, min(source_h, source_w)))
                    width = max(32, round(source_w * scale / 32) * 32)
                    height = max(32, round(source_h * scale / 32) * 32)

                # 目标时间点 <= 当前帧时间：沿用当前帧，完成 24fps 重采样
                while (
                    len(frames) < len(targets)
                    and targets[len(frames)] <= time + 0.5 / 24
                ):
                    frames.append(self._frame_to_tensor(last, width, height, dtype))

        # 源视频帧率低或结尾时间不足时，用最后一帧补满目标时间轴
        while len(frames) < len(targets) and last is not None:
            frames.append(self._frame_to_tensor(last, width, height, dtype))
        if not frames and last is not None:
            frames.append(self._frame_to_tensor(last, width, height, dtype))
        if not frames:
            raise ValueError("参考视频没有可读取的帧")

        image = torch.stack(frames, dim=0).to(device=device, dtype=dtype)
        audio = self._load_audio(target, duration, require_audio)
        return (image, audio)

    @staticmethod
    def _frame_to_tensor(array, width, height, dtype):
        import numpy as np
        import torch

        import comfy.utils

        tensor = torch.from_numpy(np.asarray(array).astype(np.float32) / 255.0)
        tensor = tensor.permute(2, 0, 1).unsqueeze(0)
        tensor = comfy.utils.common_upscale(tensor, width, height, "lanczos", "disabled")
        return tensor.squeeze(0).permute(1, 2, 0).to(dtype=dtype)

    @staticmethod
    def _load_audio(target, max_seconds, required):
        import torch

        if not required:
            return {"waveform": torch.zeros((1, 2, 1)), "sample_rate": 32000}

        from comfy_extras.nodes_audio import load as load_audio

        waveform, sample_rate = load_audio(str(target))
        limit = max(1, int(max_seconds * sample_rate))
        waveform = waveform[:, :limit]
        # H3 AudioVAE 按立体声编码；单声道复制成左右两轨
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        elif waveform.shape[0] > 2:
            waveform = waveform[:2]
        return {"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate}


class FilmlineLoadAudio:
    """读取音频资产并限制时长，供 H3 Ref2VA 的独立音频参考使用。"""

    CATEGORY = "filmline"
    FUNCTION = "load"
    RETURN_TYPES = ("AUDIO",)
    RETURN_NAMES = ("audio",)
    DESCRIPTION = "读取 Filmline 音频资产，截断到指定时长。"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "path": ("STRING", {"default": "", "multiline": False}),
                "max_seconds": (
                    "FLOAT",
                    {"default": 15.0, "min": 0.1, "max": 15.0, "step": 0.1},
                ),
            }
        }

    def load(self, path, max_seconds=15.0):
        from comfy_extras.nodes_audio import load as load_audio

        from .. import storage

        target = storage.resolve(path)
        if not target.is_file():
            raise FileNotFoundError(f"资产文件不存在: {path}")
        waveform, sample_rate = load_audio(str(target))
        limit = max(1, int(float(max_seconds) * sample_rate))
        waveform = waveform[:, :limit]
        if waveform.shape[0] == 1:
            waveform = waveform.repeat(2, 1)
        elif waveform.shape[0] > 2:
            waveform = waveform[:2]
        return ({"waveform": waveform.unsqueeze(0), "sample_rate": sample_rate},)


NODE_CLASS_MAPPINGS = {
    "FilmlineEmptyLatent": FilmlineEmptyLatent,
    "FilmlineLoadImage": FilmlineLoadImage,
    "FilmlineLoadVideo": FilmlineLoadVideo,
    "FilmlineLoadAudio": FilmlineLoadAudio,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "FilmlineEmptyLatent": "Filmline 空 Latent（任意尺寸）",
    "FilmlineLoadImage": "Filmline 读取资产图片",
    "FilmlineLoadVideo": "Filmline 读取资产视频",
    "FilmlineLoadAudio": "Filmline 读取资产音频",
}

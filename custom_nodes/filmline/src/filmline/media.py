"""媒体探测：视频/音频的时长、帧率与音轨信息。

生成接口和上传接口都以这里的结果为准，避免只信扩展名或前端参数。
"""

from __future__ import annotations

import base64
import io
from dataclasses import asdict, dataclass
from pathlib import Path

from .errors import InvalidArgument

SUPPORTED_IMAGE_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}
MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024
MAX_INLINE_IMAGE_PIXELS = 1600


@dataclass(frozen=True)
class MediaInfo:
    duration: float
    fps: float | None = None
    has_audio: bool = False
    width: int | None = None
    height: int | None = None
    sample_rate: int | None = None
    channels: int | None = None

    def as_dict(self) -> dict:
        return asdict(self)


def _stream_duration(stream, container) -> float:
    if stream is not None and stream.duration is not None and stream.time_base is not None:
        return float(stream.duration * stream.time_base)
    if container.duration is not None:
        return float(container.duration / 1_000_000)  # av.time_base
    return 0.0


def _image_payload(raw: bytes, mime: str) -> str:
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}"


def image_data_url(path: Path) -> str:
    """把资产图片转成 DeepSeek 可接受的 data URL。

    原生支持的格式直接发送；BMP/AVIF 或过大的图片用 Pillow 转成压缩 JPEG。
    """
    suffix = path.suffix.lower()
    raw = path.read_bytes()
    mime = SUPPORTED_IMAGE_MIME.get(suffix)
    if mime and len(raw) <= MAX_INLINE_IMAGE_BYTES:
        return _image_payload(raw, mime)

    try:
        from PIL import Image, ImageOps

        with Image.open(path) as source:
            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((MAX_INLINE_IMAGE_PIXELS, MAX_INLINE_IMAGE_PIXELS))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
        return _image_payload(buffer.getvalue(), "image/jpeg")
    except Exception as exc:
        raise InvalidArgument("无法读取图片，不能发送给 AI 优化") from exc


def probe(path: Path) -> MediaInfo:
    """读取媒体信息；无法解析时抛 InvalidArgument（而不是泄漏 ffmpeg 细节）。"""
    try:
        import av
    except ImportError as exc:  # pragma: no cover - ComfyUI 自带 av
        raise InvalidArgument("当前环境缺少 PyAV，无法读取媒体信息") from exc

    try:
        with av.open(str(path)) as container:
            video = next(iter(container.streams.video), None)
            audio = next(iter(container.streams.audio), None)
            if video is None and audio is None:
                raise InvalidArgument("文件不包含视频或音频流")

            duration = max(_stream_duration(video, container), _stream_duration(audio, container))
            if duration <= 0:
                raise InvalidArgument("无法读取媒体时长")

            fps = None
            if video is not None:
                rate = video.average_rate or video.guessed_rate
                if rate:
                    fps = float(rate)

            return MediaInfo(
                duration=round(duration, 3),
                fps=round(fps, 3) if fps else None,
                has_audio=audio is not None,
                width=int(video.width) if video is not None else None,
                height=int(video.height) if video is not None else None,
                sample_rate=int(audio.codec_context.sample_rate) if audio is not None else None,
                channels=int(audio.codec_context.channels) if audio is not None else None,
            )
    except InvalidArgument:
        raise
    except Exception as exc:
        raise InvalidArgument("无法读取媒体信息，文件可能已损坏或格式不受支持") from exc

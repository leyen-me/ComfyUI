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
# 官方单边上限 8192；单请求 >=15 张时降为 4096，这里按更严格的一档处理
MAX_INLINE_IMAGE_EDGE = 4096


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

    原生支持、体积和像素都在官方限制内时直接发送；否则用 Pillow 转成
    长边 1600 的 JPEG。无论走哪条路径，都不会把单边超过 4096px 的图片
    原样发出去（官方在 >=15 张时就是 4096 上限）。
    """
    suffix = path.suffix.lower()
    raw = path.read_bytes()
    mime = SUPPORTED_IMAGE_MIME.get(suffix)

    try:
        from PIL import Image, ImageOps

        with Image.open(path) as source:
            width, height = source.size
            if (
                mime
                and len(raw) <= MAX_INLINE_IMAGE_BYTES
                and max(width, height) <= MAX_INLINE_IMAGE_EDGE
            ):
                return _image_payload(raw, mime)

            image = ImageOps.exif_transpose(source).convert("RGB")
            image.thumbnail((MAX_INLINE_IMAGE_PIXELS, MAX_INLINE_IMAGE_PIXELS))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
        return _image_payload(buffer.getvalue(), "image/jpeg")
    except Exception as exc:
        raise InvalidArgument("无法读取图片，不能发送给 AI 优化") from exc


def video_frame_data_url(path: Path, seconds: float) -> str:
    """抽取视频指定时间点的一帧，作为 JPEG data URL 发给 AI 优化。"""
    try:
        import av

        with av.open(str(path)) as container:
            stream = container.streams.video[0] if container.streams.video else None
            if stream is None:
                raise InvalidArgument("参考视频不包含视频流")
            target = max(0.0, float(seconds))
            if stream.time_base is not None:
                try:
                    container.seek(
                        int(target / stream.time_base), stream=stream, backward=True
                    )
                except Exception:
                    pass

            frame = None
            for candidate in container.decode(stream):
                if candidate.time is not None:
                    stamp = float(candidate.time)
                elif candidate.pts is not None and stream.time_base is not None:
                    stamp = float(candidate.pts * stream.time_base)
                else:
                    stamp = target
                frame = candidate
                if stamp >= target - 1e-6:
                    break
            if frame is None:
                raise InvalidArgument("无法读取参考视频帧")

            from PIL import Image

            image = Image.fromarray(frame.to_ndarray(format="rgb24")).convert("RGB")
            image.thumbnail((MAX_INLINE_IMAGE_PIXELS, MAX_INLINE_IMAGE_PIXELS))
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=88, optimize=True)
            return _image_payload(buffer.getvalue(), "image/jpeg")
    except InvalidArgument:
        raise
    except Exception as exc:
        raise InvalidArgument("无法读取参考视频帧，不能发送给 AI 优化") from exc


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


def _decode_rgb_frame(container, stream, seconds: float):
    """跳到指定秒并返回第一帧（RGB PIL Image）。"""
    import av  # noqa: F401  (确保异常信息一致)
    from PIL import Image

    target = max(0.0, float(seconds))
    if stream.time_base is not None:
        try:
            container.seek(int(target / stream.time_base), stream=stream, backward=True)
        except Exception:
            pass
    frame = None
    for candidate in container.decode(stream):
        if candidate.time is not None:
            stamp = float(candidate.time)
        elif candidate.pts is not None and stream.time_base is not None:
            stamp = float(candidate.pts * stream.time_base)
        else:
            stamp = target
        frame = candidate
        if stamp >= target - 1e-6:
            break
    if frame is None:
        raise InvalidArgument("无法读取视频帧")
    return Image.fromarray(frame.to_ndarray(format="rgb24")).convert("RGB")


def video_contact_sheet_data_url(path: Path, seconds: list[float]) -> str:
    """把多个时间点的帧拼成一张网格图（3 列），供模型一次看完动作走向。"""
    try:
        import av
        from PIL import Image, ImageDraw

        stamps = [max(0.0, float(value)) for value in seconds] or [0.0]
        tiles = []
        with av.open(str(path)) as container:
            stream = container.streams.video[0] if container.streams.video else None
            if stream is None:
                raise InvalidArgument("视频不包含视频流")
            for stamp in stamps:
                image = _decode_rgb_frame(container, stream, stamp)
                image.thumbnail((480, 480))
                tiles.append((stamp, image))

        columns = min(3, len(tiles))
        rows = (len(tiles) + columns - 1) // columns
        padding = 6
        label_height = 18
        tile_width = max(image.width for _, image in tiles)
        tile_height = max(image.height for _, image in tiles) + label_height
        canvas = Image.new(
            "RGB",
            (
                columns * tile_width + padding * (columns + 1),
                rows * tile_height + padding * (rows + 1),
            ),
            (18, 18, 20),
        )
        draw = ImageDraw.Draw(canvas)
        for index, (stamp, image) in enumerate(tiles):
            column = index % columns
            row = index // columns
            x = padding + column * (tile_width + padding)
            y = padding + row * (tile_height + padding)
            canvas.paste(image, (x, y + label_height))
            draw.text((x + 2, y + 2), f"{stamp:.2f}s", fill=(220, 220, 220))

        buffer = io.BytesIO()
        canvas.save(buffer, format="JPEG", quality=86, optimize=True)
        return _image_payload(buffer.getvalue(), "image/jpeg")
    except InvalidArgument:
        raise
    except Exception as exc:
        raise InvalidArgument("无法生成视频帧拼图") from exc


def video_frame_image(path: Path, seconds: float):
    """读取单帧，返回 PIL Image（用于另存为图片资产）。"""
    try:
        import av

        with av.open(str(path)) as container:
            stream = container.streams.video[0] if container.streams.video else None
            if stream is None:
                raise InvalidArgument("视频不包含视频流")
            return _decode_rgb_frame(container, stream, seconds)
    except InvalidArgument:
        raise
    except Exception as exc:
        raise InvalidArgument("无法读取视频帧") from exc

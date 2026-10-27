"""媒体读取工具：图片进模型、视频抽帧拼图、音频元信息、抽帧存资产。"""

from __future__ import annotations

import asyncio

from ... import media, storage
from ...domain.assets import AssetService
from ...domain.episodes import EpisodeService
from ...domain.schemas import AssetKind, AssetSource
from ...errors import InvalidArgument, NotFound
from .base import Tool, ToolContext, ToolOutcome, register

MAX_IMAGES_PER_CALL = 1
MAX_FRAMES = 9


def _resolve(ctx: ToolContext, asset_id: int, kinds: set[str]):
    assets = AssetService()
    item = assets.resolve_assets(
        ctx.project_id, [asset_id], kinds=kinds, limit=1, label="资产"
    )[0]
    return item


async def _probe(ctx: ToolContext, args: dict) -> ToolOutcome:
    asset = await asyncio.to_thread(_resolve, ctx, args["asset_id"], {"image", "video", "audio"})
    info = await asyncio.to_thread(media.probe, storage.resolve(asset.path))
    return ToolOutcome(
        summary=f"「{asset.name}」{info.duration:.2f}s"
        + (f"，{info.width}×{info.height}" if info.width else "")
        + (f"，{info.fps:g}fps" if info.fps else "")
        + ("，有音轨" if info.has_audio else "，无音轨"),
        data={
            "asset_id": asset.id,
            "name": asset.name,
            "kind": asset.kind,
            **info.as_dict(),
        },
    )


async def _read_image(ctx: ToolContext, args: dict) -> ToolOutcome:
    asset = await asyncio.to_thread(_resolve, ctx, args["asset_id"], {"image"})
    target = storage.resolve(asset.path)
    if not target.is_file():
        raise NotFound("图片文件已丢失")
    data_url = await asyncio.to_thread(media.image_data_url, target)
    await ctx.notify("读取图片")
    return ToolOutcome(
        summary=f"已读取图片「{asset.name}」",
        data={"asset_id": asset.id, "name": asset.name},
        images=[{"label": asset.name, "data_url": data_url}],
        meta={"image_count": 1},
    )


async def _read_video(ctx: ToolContext, args: dict) -> ToolOutcome:
    asset = await asyncio.to_thread(_resolve, ctx, args["asset_id"], {"video"})
    target = storage.resolve(asset.path)
    if not target.is_file():
        raise NotFound("视频文件已丢失")
    info = await asyncio.to_thread(media.probe, target)
    start = max(0.0, float(args.get("start", 0.0)))
    end = float(args.get("end") or info.duration)
    end = min(end, info.duration)
    if end <= start:
        raise InvalidArgument("end 必须大于 start")
    frames = max(1, min(MAX_FRAMES, int(args.get("frames", 6))))
    if frames == 1:
        stamps = [start]
    else:
        span = end - start
        stamps = [start + span * index / (frames - 1) for index in range(frames)]
    await ctx.notify(f"抽取 {frames} 帧并拼图", 20)
    data_url = await asyncio.to_thread(media.video_contact_sheet_data_url, target, stamps)
    return ToolOutcome(
        summary=f"「{asset.name}」{start:.2f}–{end:.2f}s，已按 {frames} 帧拼成一张网格图",
        data={
            "asset_id": asset.id,
            "name": asset.name,
            "duration": info.duration,
            "fps": info.fps,
            "width": info.width,
            "height": info.height,
            "has_audio": info.has_audio,
            "timestamps": [round(value, 3) for value in stamps],
            "layout": "从左到右、从上到下按时间递增",
        },
        images=[{"label": f"{asset.name} 帧拼图", "data_url": data_url}],
        meta={"image_count": 1},
    )


async def _read_audio(ctx: ToolContext, args: dict) -> ToolOutcome:
    asset = await asyncio.to_thread(_resolve, ctx, args["asset_id"], {"audio"})
    target = storage.resolve(asset.path)
    info = await asyncio.to_thread(media.probe, target)
    return ToolOutcome(
        summary=f"「{asset.name}」{info.duration:.2f}s，{info.sample_rate or '?'}Hz / {info.channels or '?'} 声道",
        data={
            "asset_id": asset.id,
            "name": asset.name,
            **info.as_dict(),
            "note": (
                "当前模型不能直接听音频。本工具只返回时长、采样率、声道等技术信息；"
                "要理解台词或声音内容，请让用户提供文字稿，或用 extract_frame 看视频画面。"
            ),
        },
    )


async def _extract_frame(ctx: ToolContext, args: dict) -> ToolOutcome:
    asset = await asyncio.to_thread(_resolve, ctx, args["asset_id"], {"video"})
    target = storage.resolve(asset.path)
    info = await asyncio.to_thread(media.probe, target)
    seconds = min(max(0.0, float(args["at_seconds"])), max(0.0, info.duration - 0.05))
    await ctx.notify(f"抽取 {seconds:.2f}s 画面", 30)

    episode_id = None
    scope = "project"
    if args.get("episode"):
        code = args["episode"].upper()
        episode_id = await asyncio.to_thread(EpisodeService().resolve_id, ctx.project_id, code)
        scope = code

    def _write() -> dict:
        image = media.video_frame_image(target, seconds)
        relative, absolute = storage.allocate(ctx.project_id, scope, ".jpg")
        image.save(absolute, format="JPEG", quality=92, optimize=True)
        created = AssetService().create_from_file(
            ctx.project_id,
            name=args.get("name") or f"{asset.name} @ {seconds:.2f}s",
            kind=AssetKind.image,
            source=AssetSource.user,
            relative_path=relative,
            mime_type="image/jpeg",
            size_bytes=absolute.stat().st_size,
            episode_id=episode_id,
            meta={
                "derived_from_asset_id": asset.id,
                "at_seconds": round(seconds, 3),
                "frame_index": round(seconds * (info.fps or 24)),
            },
        )
        return {"id": created.id, "name": created.name, "episode_id": created.episode_id}

    created = await asyncio.to_thread(_write)
    return ToolOutcome(
        summary=f"已从「{asset.name}」{seconds:.2f}s 抽帧并保存为图片资产 #{created['id']}",
        data=created,
    )


def register_tools() -> None:
    register(
        Tool(
            name="probe_media",
            label="探测媒体",
            description="读取图片/视频/音频的时长、分辨率、帧率、声道等技术信息。",
            parameters={
                "type": "object",
                "properties": {"asset_id": {"type": "integer", "minimum": 1}},
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_probe,
        )
    )
    register(
        Tool(
            name="read_image",
            label="查看图片",
            description=(
                "把图片资产送进模型上下文，真正看到画面内容。用于分析参考图、"
                "生成结果、首尾帧。"
            ),
            parameters={
                "type": "object",
                "properties": {"asset_id": {"type": "integer", "minimum": 1}},
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_read_image,
        )
    )
    register(
        Tool(
            name="read_video",
            label="查看视频",
            description=(
                "按时间区间均匀抽 1–9 帧，拼成一张网格图送进模型上下文，用来理解动作、"
                "运镜和画面走向。需要精确某一点时用 extract_frame。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer", "minimum": 1},
                    "start": {"type": "number", "minimum": 0},
                    "end": {"type": "number", "minimum": 0},
                    "frames": {"type": "integer", "minimum": 1, "maximum": MAX_FRAMES, "default": 6},
                },
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_read_video,
        )
    )
    register(
        Tool(
            name="read_audio",
            label="读取音频",
            description=(
                "读取音频资产的技术信息。模型不能直接听声音，需要内容时请让用户提供文字稿。"
            ),
            parameters={
                "type": "object",
                "properties": {"asset_id": {"type": "integer", "minimum": 1}},
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_read_audio,
        )
    )
    register(
        Tool(
            name="extract_frame",
            label="抽取视频帧",
            description=(
                "从视频资产指定秒数抽一帧，保存为图片资产。常用于制作首尾帧、"
                "或把上一段视频的末帧作为下一段的首帧。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer", "minimum": 1},
                    "at_seconds": {"type": "number", "minimum": 0},
                    "name": {"type": "string", "maxLength": 200},
                    "episode": {"type": "string", "maxLength": 16},
                },
                "required": ["asset_id", "at_seconds"],
                "additionalProperties": False,
            },
            handler=_extract_frame,
            write=True,
        )
    )

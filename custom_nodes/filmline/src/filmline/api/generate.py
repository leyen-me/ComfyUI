"""生成接口：校验参数、创建持久化任务并交给后台 runner。

    POST /studio/api/projects/{ref}/generate?episode=EP01
    body: {kind, prompt, size, count?, duration?}

请求本身不再等待 ComfyUI 跑完，立即返回 task；刷新页面不会中断生成。
"""

from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass

from aiohttp import web

from .. import generation, media, storage
from ..domain.assets import AssetService
from ..domain.episodes import EpisodeService
from ..domain.projects import ProjectService
from ..domain.tasks import TaskService
from ..errors import InvalidArgument
from ..runner import RUNNER_KEY
from .http import handle_errors, ok, read_object

VIDEO_MODES = ("keyframes", "reference")


def _episode_scope(request: web.Request, project_id: int) -> tuple[int | None, str]:
    raw = (request.query.get("episode") or "").strip()
    if not raw:
        return None, "project"
    code = raw.upper()
    return EpisodeService().resolve_id(project_id, code), code


def _optional_asset_id(raw: object, field: str) -> int | None:
    """首尾帧字段允许为空；其余情况必须是正整数资产 id。"""
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        raise InvalidArgument(f"{field} 必须是资产 id")
    return raw


def _asset_id_list(raw: object, field: str) -> list[int]:
    if raw is None:
        return []
    if not isinstance(raw, list) or not all(
        isinstance(item, int) and not isinstance(item, bool) and item > 0 for item in raw
    ):
        raise InvalidArgument(f"{field} 必须是资产 id 数组")
    return raw


def _seed_value(raw: object) -> int | None:
    if raw is None or raw == "":
        return None
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise InvalidArgument("seed 必须是整数")
    if not 0 <= raw <= 2**31 - 1:
        raise InvalidArgument("seed 必须在 0–2147483647 之间")
    return raw


def _guide_list(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise InvalidArgument("ref_guides 必须是数组")
    if len(raw) > generation.MAX_VIDEO_GUIDES:
        raise InvalidArgument(f"帧锚定最多 {generation.MAX_VIDEO_GUIDES} 个")
    result: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise InvalidArgument("ref_guides 每项必须是对象")
        asset_id = _optional_asset_id(item.get("asset_id"), "ref_guides.asset_id")
        if asset_id is None:
            raise InvalidArgument("ref_guides.asset_id 不能为空")
        seconds = item.get("at_seconds", 0)
        if isinstance(seconds, bool) or not isinstance(seconds, (int, float)):
            raise InvalidArgument("ref_guides.at_seconds 必须是数字")
        if not 0 <= float(seconds) <= generation.VIDEO_MAX_SECONDS:
            raise InvalidArgument(
                f"ref_guides.at_seconds 必须在 0–{generation.VIDEO_MAX_SECONDS} 秒之间"
            )
        result.append({"asset_id": asset_id, "at_seconds": float(seconds)})
    return result


def _video_ref_list(raw: object) -> list[dict]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise InvalidArgument("ref_videos 必须是数组")
    result: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            raise InvalidArgument("ref_videos 每项必须是对象")
        asset_id = _optional_asset_id(item.get("asset_id"), "ref_videos.asset_id")
        if asset_id is None:
            raise InvalidArgument("ref_videos.asset_id 不能为空")
        use_audio = item.get("use_audio", False)
        if not isinstance(use_audio, bool):
            raise InvalidArgument("ref_videos.use_audio 必须是布尔值")
        trim = {}
        for field in ("trim_start", "trim_end"):
            value = item.get(field)
            if value is None or value == "":
                trim[field] = 0.0
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)):
                raise InvalidArgument(f"ref_videos.{field} 必须是数字")
            if not 0 <= float(value) <= 15.05:
                raise InvalidArgument(f"ref_videos.{field} 必须在 0–15 秒之间")
            trim[field] = float(value)
        result.append({"asset_id": asset_id, "use_audio": use_audio, **trim})
    return result


def _check_audio_duration(info: media.MediaInfo, label: str) -> None:
    """独立参考音频只要求非静音素材的最短长度，官方不设上限。"""
    if info.duration < 1.95:
        raise InvalidArgument(f"{label}至少需要 2 秒（当前 {info.duration:.1f} 秒）")


@dataclass(frozen=True)
class _ReferenceMaterials:
    """已校验的参考素材：id 保持前端顺序，路径/时长已探明。"""

    image_ids: list[int]
    image_paths: list[str]
    video_ids: list[int]
    video_use_audio: list[bool]
    video_trims: list[tuple[float, float]]
    video_refs: list[generation.VideoReference]
    audio_ids: list[int]
    audio_paths: list[str]
    audio_durations: list[float]
    guide_ids: list[int]
    guide_specs: list[dict]
    guides: list[generation.GuideFrame]


def _resolve_video_interval(
    info: media.MediaInfo, item: dict, name: str
) -> tuple[float, float]:
    """把用户裁剪区间收敛到素材实际时长内。"""
    start = min(max(float(item["trim_start"]), 0.0), info.duration)
    end = info.duration if item["trim_end"] <= 0 else min(
        max(float(item["trim_end"]), 0.0), info.duration
    )
    if end <= start:
        raise InvalidArgument(f"参考视频「{name}」裁剪区间无效：{start:.2f}s–{end:.2f}s")
    if not 1.95 <= end - start <= 15.05:
        raise InvalidArgument(
            f"参考视频「{name}」每段裁剪后需为 2–15 秒（当前 {end - start:.2f} 秒）"
        )
    return start, end


async def _resolve_reference_materials(
    payload: dict,
    project_id: int,
) -> _ReferenceMaterials:
    """校验并解析 ref2va 的参考图/视频/音频。"""
    assets = AssetService()
    image_ids = _asset_id_list(payload.get("refs"), "refs")
    video_items = _video_ref_list(payload.get("ref_videos"))
    audio_ids = _asset_id_list(payload.get("ref_audios"), "ref_audios")
    guide_items = _guide_list(payload.get("ref_guides"))
    video_ids = [item["asset_id"] for item in video_items]
    video_use_audio = [item["use_audio"] for item in video_items]
    # 同一张图可以锚定多个时间点，按去重后的 id 解析资产
    guide_ids = list(dict.fromkeys(item["asset_id"] for item in guide_items))

    all_ids = [*image_ids, *video_ids, *audio_ids]
    if not all_ids:
        raise InvalidArgument("参考生成至少需要 1 个素材")
    if not image_ids and not video_ids:
        # 官方 Ref2VA 的视觉条件来自图片/视频；只有独立音频时参考不生效
        raise InvalidArgument("参考生成至少需要 1 张参考图或 1 段参考视频")
    if len(all_ids) > generation.MAX_VIDEO_FILES:
        raise InvalidArgument(f"参考素材合计最多 {generation.MAX_VIDEO_FILES} 个")
    if len(set(all_ids)) != len(all_ids):
        raise InvalidArgument("参考素材不能重复")

    image_assets = await asyncio.to_thread(
        assets.resolve_assets,
        project_id,
        image_ids,
        kinds={"image"},
        limit=generation.MAX_VIDEO_REFS,
        label="参考图",
    )
    video_assets = await asyncio.to_thread(
        assets.resolve_assets,
        project_id,
        video_ids,
        kinds={"video"},
        limit=generation.MAX_VIDEO_VIDEOS,
        label="参考视频",
    )
    audio_assets = await asyncio.to_thread(
        assets.resolve_assets,
        project_id,
        audio_ids,
        kinds={"audio"},
        limit=generation.MAX_VIDEO_AUDIOS,
        label="参考音频",
    )
    guide_assets = await asyncio.to_thread(
        assets.resolve_assets,
        project_id,
        guide_ids,
        kinds={"image"},
        limit=generation.MAX_VIDEO_GUIDES,
        label="帧锚定图片",
    )

    video_refs: list[generation.VideoReference] = []
    video_trims: list[tuple[float, float]] = []
    video_total = 0.0
    for item, asset in zip(video_items, video_assets):
        info = await asyncio.to_thread(media.probe, storage.resolve(asset.path))
        if item["use_audio"] and not info.has_audio:
            raise InvalidArgument(f"参考视频「{asset.name}」没有音轨")
        start, end = _resolve_video_interval(info, item, asset.name)
        video_total += end - start
        video_trims.append((start, end))
        video_refs.append(
            generation.VideoReference(
                path=asset.path,
                use_audio=item["use_audio"],
                trim_start=start,
                trim_end=end,
            )
        )
    if video_total > 15.05:
        raise InvalidArgument(f"参考视频总时长不能超过 15 秒（当前 {video_total:.1f} 秒）")

    audio_durations: list[float] = []
    for asset in audio_assets:
        info = await asyncio.to_thread(media.probe, storage.resolve(asset.path))
        _check_audio_duration(info, "参考音频")
        audio_durations.append(info.duration)

    guide_paths = {asset.id: asset.path for asset in guide_assets}
    guides = [
        generation.GuideFrame(
            path=guide_paths[item["asset_id"]],
            frame_index=round(item["at_seconds"] * generation.VIDEO_FPS),
        )
        for item in guide_items
    ]

    return _ReferenceMaterials(
        image_ids=image_ids,
        image_paths=[asset.path for asset in image_assets],
        video_ids=video_ids,
        video_use_audio=video_use_audio,
        video_trims=video_trims,
        video_refs=video_refs,
        audio_ids=audio_ids,
        audio_paths=[asset.path for asset in audio_assets],
        audio_durations=audio_durations,
        guide_ids=guide_ids,
        guide_specs=guide_items,
        guides=guides,
    )


async def _resolve_keyframe_paths(
    assets: AssetService, project_id: int, first_id: int | None, last_id: int | None
) -> dict[int, str]:
    """解析首尾帧并返回 id → 路径；顺序决定首/尾，与资产 id 大小无关。"""
    frame_ids = [asset_id for asset_id in (first_id, last_id) if asset_id is not None]
    paths = await asyncio.to_thread(
        assets.resolve_ref_paths,
        project_id,
        frame_ids,
        limit=2,
        label="首尾帧图片",
    )
    return dict(zip(frame_ids, paths))



def register_generate_routes(routes: web.RouteTableDef) -> None:
    assets = AssetService()

    @routes.post("/studio/api/projects/{ref}/generate")
    @handle_errors
    async def generate(request: web.Request) -> web.Response:
        payload = await read_object(request)
        kind = str(payload.get("kind") or "image")
        prompt = str(payload.get("prompt") or "")
        size = str(payload.get("size") or ("16:9" if kind == "video" else "1:1"))
        client_label = str(payload.get("client_label") or "").strip()[:40]

        if kind not in ("image", "video"):
            raise InvalidArgument("kind 只支持 image / video")

        project = await asyncio.to_thread(ProjectService().get, request.match_info["ref"])
        episode_id, scope = await asyncio.to_thread(_episode_scope, request, project.id)

        if kind == "image":
            raw_refs = payload.get("refs") or []
            if not isinstance(raw_refs, list) or not all(
                isinstance(item, int) and not isinstance(item, bool) and item > 0
                for item in raw_refs
            ):
                raise InvalidArgument("refs 必须是资产 id 数组")
            ref_paths = await asyncio.to_thread(
                assets.resolve_ref_paths,
                project.id,
                raw_refs,
                limit=generation.MAX_IMAGE_REFS,
            )

            tier = str(payload.get("resolution") or "1k").lower()
            if tier not in generation.IMAGE_TIERS:
                raise InvalidArgument(f"resolution 只支持: {' / '.join(generation.IMAGE_TIERS)}")
            count = payload.get("count", 1)
            if not isinstance(count, int):
                raise InvalidArgument("count 必须是整数")
            if ref_paths:
                count = 1
            workflow = generation.image_workflow(
                prompt=prompt,
                size=size,
                count=count,
                tier=tier,
                refs=ref_paths,
                seed=_seed_value(payload.get("seed")),
                prefix=f"filmline/{project.code}/{scope}",
            )
        else:
            mode = str(payload.get("mode") or "keyframes")
            if mode not in VIDEO_MODES:
                raise InvalidArgument("视频生成方式只支持 keyframes / reference")

            first_id = _optional_asset_id(payload.get("first_frame_id"), "first_frame_id")
            last_id = _optional_asset_id(payload.get("last_frame_id"), "last_frame_id")
            raw_refs: list[int] = []
            frame_ids: list[int] = []
            video_ids: list[int] = []
            video_use_audio: list[bool] = []
            video_trims: list[tuple[float, float]] = []
            audio_ids: list[int] = []
            auto_duration = payload.get("auto_duration", False)
            if not isinstance(auto_duration, bool):
                raise InvalidArgument("auto_duration 必须是布尔值")
            seed = _seed_value(payload.get("seed"))

            video_tier = str(payload.get("resolution") or generation.DEFAULT_VIDEO_TIER).lower()
            if video_tier not in generation.VIDEO_TIERS:
                raise InvalidArgument(
                    f"视频分辨率只支持: {' / '.join(generation.VIDEO_TIERS)}"
                )
            duration = payload.get("duration", 5)
            if isinstance(duration, bool) or not isinstance(duration, (int, float)):
                raise InvalidArgument("duration 必须是数字")
            duration = float(duration)
            if not auto_duration and not (
                generation.VIDEO_MIN_SECONDS <= duration <= generation.VIDEO_MAX_SECONDS
            ):
                raise InvalidArgument(
                    f"视频时长只支持 {generation.VIDEO_MIN_SECONDS}–"
                    f"{generation.VIDEO_MAX_SECONDS} 秒"
                )

            if mode == "keyframes":
                if payload.get("ref_videos") or payload.get("ref_audios"):
                    raise InvalidArgument("首尾帧模式不能使用参考视频或参考音频")
                if auto_duration:
                    raise InvalidArgument("只有参考生成支持按音频自动定时长")
                # 旧客户端只发 refs（最多 1 张），按首帧解释
                legacy_refs = payload.get("refs")
                if legacy_refs is not None:
                    if first_id is not None or last_id is not None:
                        raise InvalidArgument(
                            "refs 与 first_frame_id / last_frame_id 不能同时使用"
                        )
                    if not isinstance(legacy_refs, list) or not all(
                        isinstance(item, int) and not isinstance(item, bool) and item > 0
                        for item in legacy_refs
                    ):
                        raise InvalidArgument("refs 必须是资产 id 数组")
                    if len(legacy_refs) > 1:
                        raise InvalidArgument("视频首帧只支持 1 张")
                    if legacy_refs:
                        first_id = legacy_refs[0]

                frame_ids = [
                    asset_id for asset_id in (first_id, last_id) if asset_id is not None
                ]
                paths_by_id = await _resolve_keyframe_paths(
                    assets, project.id, first_id, last_id
                )
                workflow = generation.video_workflow(
                    prompt=prompt,
                    size=size,
                    duration=duration,
                    tier=video_tier,
                    first_frame=paths_by_id.get(first_id) if first_id is not None else None,
                    last_frame=paths_by_id.get(last_id) if last_id is not None else None,
                    seed=seed,
                    prefix=f"filmline/{project.code}/{scope}",
                )
            else:
                if first_id is not None or last_id is not None:
                    raise InvalidArgument("参考生成不能使用 first_frame_id / last_frame_id")

                ref_image_size = str(payload.get("ref_image_size") or "match").lower()
                if ref_image_size not in ("match", "max"):
                    raise InvalidArgument("ref_image_size 只支持 match / max")
                quality = str(payload.get("ref_quality") or generation.DEFAULT_REF_QUALITY)
                if quality not in generation.REF_QUALITY_PRESETS:
                    raise InvalidArgument(
                        f"ref_quality 只支持: {' / '.join(generation.REF_QUALITY_PRESETS)}"
                    )
                scheduler = payload.get("ref_scheduler")
                if scheduler is not None:
                    scheduler = str(scheduler)
                    if scheduler not in generation.REF_SCHEDULERS:
                        raise InvalidArgument(
                            f"ref_scheduler 只支持: {' / '.join(generation.REF_SCHEDULERS)}"
                        )

                materials = await _resolve_reference_materials(payload, project.id)
                raw_refs = materials.image_ids
                video_ids = materials.video_ids
                video_use_audio = materials.video_use_audio
                video_trims = materials.video_trims
                audio_ids = materials.audio_ids

                if auto_duration:
                    candidates = list(materials.audio_durations)
                    candidates.extend(
                        end - start
                        for (start, end), use_audio in zip(
                            materials.video_trims, materials.video_use_audio
                        )
                        if use_audio
                    )
                    if not candidates:
                        raise InvalidArgument("已启用按音频自动定时长，但当前没有可用参考音频")
                    duration = min(
                        generation.VIDEO_MAX_SECONDS,
                        max(generation.VIDEO_MIN_SECONDS, max(candidates)),
                    )

                workflow = generation.video_reference_workflow(
                    prompt=prompt,
                    size=size,
                    duration=duration,
                    tier=video_tier,
                    seed=seed,
                    refs=materials.image_paths,
                    ref_videos=materials.video_refs,
                    ref_audios=materials.audio_paths,
                    ref_image_size=ref_image_size,
                    quality=quality,
                    scheduler=scheduler,
                    guides=materials.guides,
                    prefix=f"filmline/{project.code}/{scope}",
                )

        meta = dict(workflow.meta)
        if kind == "image":
            meta["ref_ids"] = raw_refs
        else:
            meta["video_mode"] = mode
            meta["ref_ids"] = frame_ids if mode == "keyframes" else raw_refs
            if mode == "keyframes":
                meta["first_frame_id"] = first_id
                meta["last_frame_id"] = last_id
            else:
                meta["ref_video_ids"] = video_ids
                meta["ref_video_use_audio"] = video_use_audio
                meta["ref_video_trims"] = [list(pair) for pair in video_trims]
                meta["ref_audio_ids"] = audio_ids
                meta["ref_guide_ids"] = materials.guide_ids
                meta["ref_guide_frames"] = [
                    {
                        "asset_id": item["asset_id"],
                        "at_seconds": item["at_seconds"],
                        "frame_index": round(item["at_seconds"] * generation.VIDEO_FPS),
                    }
                    for item in materials.guide_specs
                ]
                meta["auto_duration"] = auto_duration
                meta["ref_quality"] = quality
                meta["ref_scheduler"] = scheduler or generation.VIDEO_REF_SCHEDULER

        task = await asyncio.to_thread(
            TaskService().create,
            project_id=project.id,
            episode_id=episode_id,
            kind=workflow.kind,
            prompt=prompt,
            payload={"graph": workflow.prompt, "meta": meta, "scope": scope, "client_label": client_label},
        )
        runner = request.app.get(RUNNER_KEY)
        if runner is None:
            raise InvalidArgument("任务执行器未初始化")
        runner.schedule(task.id)
        return ok({"task": asdict(task)}, status=202)

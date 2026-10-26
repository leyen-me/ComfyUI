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

VIDEO_MODES = ("keyframes", "reference", "hybrid")


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


def _video_ref_list(raw: object) -> list[tuple[int, bool]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise InvalidArgument("ref_videos 必须是数组")
    result: list[tuple[int, bool]] = []
    for item in raw:
        if not isinstance(item, dict):
            raise InvalidArgument("ref_videos 每项必须是对象")
        asset_id = _optional_asset_id(item.get("asset_id"), "ref_videos.asset_id")
        if asset_id is None:
            raise InvalidArgument("ref_videos.asset_id 不能为空")
        use_audio = item.get("use_audio", False)
        if not isinstance(use_audio, bool):
            raise InvalidArgument("ref_videos.use_audio 必须是布尔值")
        result.append((asset_id, use_audio))
    return result


def _check_reference_duration(info: media.MediaInfo, label: str) -> None:
    if info.duration < 1.95 or info.duration > 15.05:
        raise InvalidArgument(f"{label}时长必须在 2–15 秒之间（当前 {info.duration:.1f} 秒）")


@dataclass(frozen=True)
class _ReferenceMaterials:
    """已校验的参考素材：id 保持前端顺序，路径/时长已探明。"""

    image_ids: list[int]
    image_paths: list[str]
    video_ids: list[int]
    video_use_audio: list[bool]
    video_refs: list[generation.VideoReference]
    audio_ids: list[int]
    audio_paths: list[str]


async def _resolve_reference_materials(
    payload: dict,
    project_id: int,
    *,
    empty_message: str = "参考生成至少需要 1 个素材",
) -> _ReferenceMaterials:
    """校验并解析 ref2va 的参考图/视频/音频，供 reference 与 hybrid 共用。"""
    assets = AssetService()
    image_ids = _asset_id_list(payload.get("refs"), "refs")
    video_items = _video_ref_list(payload.get("ref_videos"))
    audio_ids = _asset_id_list(payload.get("ref_audios"), "ref_audios")
    video_ids = [asset_id for asset_id, _ in video_items]
    video_use_audio = [use_audio for _, use_audio in video_items]

    all_ids = [*image_ids, *video_ids, *audio_ids]
    if not all_ids:
        raise InvalidArgument(empty_message)
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

    video_refs: list[generation.VideoReference] = []
    video_total = 0.0
    for (_, use_audio), asset in zip(video_items, video_assets):
        info = await asyncio.to_thread(media.probe, storage.resolve(asset.path))
        _check_reference_duration(info, "参考视频")
        if use_audio and not info.has_audio:
            raise InvalidArgument(f"参考视频「{asset.name}」没有音轨")
        video_total += info.duration
        video_refs.append(generation.VideoReference(path=asset.path, use_audio=use_audio))
    if video_total > 15.05:
        raise InvalidArgument(f"参考视频总时长不能超过 15 秒（当前 {video_total:.1f} 秒）")

    audio_total = 0.0
    for asset in audio_assets:
        info = await asyncio.to_thread(media.probe, storage.resolve(asset.path))
        _check_reference_duration(info, "参考音频")
        audio_total += info.duration
    if audio_total > 15.05:
        raise InvalidArgument(f"参考音频总时长不能超过 15 秒（当前 {audio_total:.1f} 秒）")

    return _ReferenceMaterials(
        image_ids=image_ids,
        image_paths=[asset.path for asset in image_assets],
        video_ids=video_ids,
        video_use_audio=video_use_audio,
        video_refs=video_refs,
        audio_ids=audio_ids,
        audio_paths=[asset.path for asset in audio_assets],
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
                prefix=f"filmline/{project.code}/{scope}",
            )
        else:
            mode = str(payload.get("mode") or "keyframes")
            if mode not in VIDEO_MODES:
                raise InvalidArgument("视频生成方式只支持 keyframes / reference / hybrid")

            first_id = _optional_asset_id(payload.get("first_frame_id"), "first_frame_id")
            last_id = _optional_asset_id(payload.get("last_frame_id"), "last_frame_id")
            raw_refs: list[int] = []
            frame_ids: list[int] = []
            video_ids: list[int] = []
            video_use_audio: list[bool] = []
            audio_ids: list[int] = []

            video_tier = str(payload.get("resolution") or "768").lower()
            if video_tier not in generation.VIDEO_TIERS:
                raise InvalidArgument(
                    f"视频分辨率只支持: {' / '.join(generation.VIDEO_TIERS)}"
                )
            duration = payload.get("duration", 5)
            if isinstance(duration, bool) or not isinstance(duration, int):
                raise InvalidArgument("duration 必须是整数")
            if not (
                generation.VIDEO_MIN_SECONDS <= duration <= generation.VIDEO_MAX_SECONDS
            ):
                raise InvalidArgument(
                    f"视频时长只支持 {generation.VIDEO_MIN_SECONDS}–"
                    f"{generation.VIDEO_MAX_SECONDS} 秒"
                )

            raw_refs: list[int] = []
            frame_ids: list[int] = []
            video_ids: list[int] = []
            video_use_audio: list[bool] = []
            audio_ids: list[int] = []

            if mode == "keyframes":
                if payload.get("ref_videos") or payload.get("ref_audios"):
                    raise InvalidArgument("首尾帧模式不能使用参考视频或参考音频")
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
                    prefix=f"filmline/{project.code}/{scope}",
                )
            else:
                if mode == "hybrid":
                    if first_id is None and last_id is None:
                        raise InvalidArgument("首帧+参考模式至少需要 1 张首帧或尾帧")
                    empty_message = "首帧+参考模式至少需要 1 个参考素材"
                else:
                    if first_id is not None or last_id is not None:
                        raise InvalidArgument("参考生成不能使用 first_frame_id / last_frame_id")
                    empty_message = "参考生成至少需要 1 个素材"

                materials = await _resolve_reference_materials(
                    payload, project.id, empty_message=empty_message
                )
                raw_refs = materials.image_ids
                video_ids = materials.video_ids
                video_use_audio = materials.video_use_audio
                audio_ids = materials.audio_ids

                paths_by_id = {}
                if mode == "hybrid":
                    frame_ids = [
                        asset_id
                        for asset_id in (first_id, last_id)
                        if asset_id is not None
                    ]
                    paths_by_id = await _resolve_keyframe_paths(
                        assets, project.id, first_id, last_id
                    )

                workflow = generation.video_reference_workflow(
                    prompt=prompt,
                    size=size,
                    duration=duration,
                    tier=video_tier,
                    refs=materials.image_paths,
                    ref_videos=materials.video_refs,
                    ref_audios=materials.audio_paths,
                    first_frame=paths_by_id.get(first_id) if first_id is not None else None,
                    last_frame=paths_by_id.get(last_id) if last_id is not None else None,
                    prefix=f"filmline/{project.code}/{scope}",
                )

        meta = dict(workflow.meta)
        if kind == "image":
            meta["ref_ids"] = raw_refs
        else:
            meta["video_mode"] = mode
            meta["ref_ids"] = frame_ids if mode == "keyframes" else raw_refs
            if mode != "reference":
                meta["first_frame_id"] = first_id
                meta["last_frame_id"] = last_id
            if mode != "keyframes":
                meta["ref_video_ids"] = video_ids
                meta["ref_video_use_audio"] = video_use_audio
                meta["ref_audio_ids"] = audio_ids

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

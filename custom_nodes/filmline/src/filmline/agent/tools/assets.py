"""资产工具：列表、读取文本、创建与修改、软删除。"""

from __future__ import annotations

import asyncio

from ...domain.assets import AssetService
from ...domain.episodes import EpisodeService
from ...domain.schemas import AssetKind, AssetSource, AssetUpdate, TextAssetCreate
from ...errors import InvalidArgument, NotFound
from .base import Tool, ToolContext, ToolOutcome, register

TEXT_READ_LIMIT = 20_000


def _episode_id(ctx: ToolContext, code: str | None) -> int | None:
    if not code:
        return None
    return EpisodeService().resolve_id(ctx.project_id, code.upper())


def _asset_brief(item) -> dict:
    text = item.text_content
    return {
        "id": item.id,
        "kind": item.kind.value,
        "source": item.source.value,
        "name": item.name,
        "episode_id": item.episode_id,
        "mime_type": item.mime_type,
        "size_bytes": item.size_bytes,
        "text_length": len(text) if text is not None else None,
        "text_preview": (text or "")[:200] if text is not None else None,
        "content_url": item.content_url,
        "created_at": item.created_at,
    }


async def _list_assets(ctx: ToolContext, args: dict) -> ToolOutcome:
    episode_id = await asyncio.to_thread(_episode_id, ctx, args.get("episode"))
    kind = AssetKind(args["kind"]) if args.get("kind") else None
    source = AssetSource(args["source"]) if args.get("source") else None
    result = await asyncio.to_thread(
        AssetService().list,
        ctx.project_id,
        episode_id=episode_id,
        kind=kind,
        source=source,
        q=args.get("q", ""),
        limit=args.get("limit", 50),
        offset=args.get("offset", 0),
    )
    scope = args.get("episode") or "项目级"
    return ToolOutcome(
        summary=f"{scope}资产共 {result.total} 个，本次返回 {len(result.items)} 个",
        data={
            "total": result.total,
            "items": [_asset_brief(item) for item in result.items],
        },
    )


async def _get_asset(ctx: ToolContext, args: dict) -> ToolOutcome:
    item = await asyncio.to_thread(AssetService().get, args["asset_id"])
    if item.project_id != ctx.project_id:
        raise NotFound("资产不属于当前项目")
    data = _asset_brief(item)
    data["meta"] = item.meta
    data["preview_url"] = item.content_url
    return ToolOutcome(summary=f"{item.kind.value}「{item.name}」", data=data)


async def _read_text(ctx: ToolContext, args: dict) -> ToolOutcome:
    item = await asyncio.to_thread(AssetService().get, args["asset_id"])
    if item.project_id != ctx.project_id:
        raise NotFound("资产不属于当前项目")
    if item.kind.value != "text":
        raise InvalidArgument("只有文本资产可以用本工具读取")
    text = item.text_content or ""
    offset = max(0, int(args.get("offset", 0)))
    limit = min(TEXT_READ_LIMIT, int(args.get("limit", 12_000)))
    if offset > len(text):
        raise InvalidArgument(f"offset 超出正文长度（共 {len(text)} 字符）")
    chunk = text[offset : offset + limit]
    end = offset + len(chunk)
    return ToolOutcome(
        summary=f"读取「{item.name}」{offset}–{end} / {len(text)} 字符",
        data={
            "asset_id": item.id,
            "name": item.name,
            "content": chunk,
            "offset": offset,
            "next_offset": end if end < len(text) else None,
            "total_chars": len(text),
        },
    )


async def _create_text(ctx: ToolContext, args: dict) -> ToolOutcome:
    episode_id = await asyncio.to_thread(_episode_id, ctx, args.get("episode"))
    item = await asyncio.to_thread(
        AssetService().create_text,
        ctx.project_id,
        TextAssetCreate(name=args["name"], content=args.get("content", "")),
        episode_id=episode_id,
    )
    return ToolOutcome(
        summary=f"已创建文本资产「{item.name}」（{len(item.text_content or '')} 字符）",
        data=_asset_brief(item),
    )


async def _update_text(ctx: ToolContext, args: dict) -> ToolOutcome:
    item = await asyncio.to_thread(AssetService().get, args["asset_id"])
    if item.project_id != ctx.project_id:
        raise NotFound("资产不属于当前项目")
    payload = AssetUpdate(name=args.get("name"), text_content=args.get("content"))
    if item.kind.value != "text" and args.get("content") is not None:
        raise InvalidArgument("只有文本资产可以修改正文")
    updated = await asyncio.to_thread(AssetService().update, item.id, payload)
    return ToolOutcome(summary=f"已更新「{updated.name}」", data=_asset_brief(updated))


async def _delete_asset(ctx: ToolContext, args: dict) -> ToolOutcome:
    if not args.get("confirmed"):
        return ToolOutcome(
            ok=False,
            summary="删除资产需要用户确认",
            error={
                "code": "confirmation_required",
                "message": "请先调用 ask_question 让用户确认，再带 confirmed=true 重试",
            },
        )
    item = await asyncio.to_thread(AssetService().get, args["asset_id"])
    if item.project_id != ctx.project_id:
        raise NotFound("资产不属于当前项目")
    await asyncio.to_thread(AssetService().delete, item.id)
    return ToolOutcome(summary=f"已软删除「{item.name}」")


def register_tools() -> None:
    register(
        Tool(
            name="list_assets",
            label="列出资产",
            description=(
                "列出当前项目或某个分集的资产。episode 留空只看项目级资产；"
                "可按键类型、来源、名称关键字筛选。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "episode": {"type": "string", "maxLength": 16},
                    "kind": {"type": "string", "enum": ["text", "image", "video", "audio"]},
                    "source": {"type": "string", "enum": ["user", "ai"]},
                    "q": {"type": "string", "maxLength": 100},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50},
                    "offset": {"type": "integer", "minimum": 0, "default": 0},
                },
                "additionalProperties": False,
            },
            handler=_list_assets,
        )
    )
    register(
        Tool(
            name="get_asset",
            label="读取资产信息",
            description="按 id 读取单个资产的元数据（名称、类型、大小、生成参数）。",
            parameters={
                "type": "object",
                "properties": {"asset_id": {"type": "integer", "minimum": 1}},
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_get_asset,
        )
    )
    register(
        Tool(
            name="read_text_asset",
            label="读取文本",
            description=(
                "读取文本资产正文，支持 offset/limit 分段续读；一次最多 20000 字符。"
                "用于读剧本、文案、提示词草稿。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer", "minimum": 1},
                    "offset": {"type": "integer", "minimum": 0, "default": 0},
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": TEXT_READ_LIMIT,
                        "default": 12_000,
                    },
                },
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_read_text,
        )
    )
    register(
        Tool(
            name="read_file",
            label="读取文件",
            description="read_text_asset 的别名：读取文本资产正文，支持分段续读。",
            parameters={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer", "minimum": 1},
                    "offset": {"type": "integer", "minimum": 0, "default": 0},
                    "limit": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": TEXT_READ_LIMIT,
                        "default": 12_000,
                    },
                },
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_read_text,
        )
    )
    register(
        Tool(
            name="create_text_asset",
            label="创建文本资产",
            description="创建文本资产，可指定归属分集（EP01）。成功需用户可见。",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 200},
                    "content": {"type": "string", "maxLength": 200_000},
                    "episode": {"type": "string", "maxLength": 16},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
            handler=_create_text,
            write=True,
        )
    )
    register(
        Tool(
            name="update_text_asset",
            label="修改资产",
            description="修改文本资产的名称或正文；其它类型只能改名。",
            parameters={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer", "minimum": 1},
                    "name": {"type": "string", "minLength": 1, "maxLength": 200},
                    "content": {"type": "string", "maxLength": 200_000},
                },
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_update_text,
            write=True,
        )
    )
    register(
        Tool(
            name="delete_asset",
            label="删除资产",
            description="软删除资产。必须先 ask_question 征得用户同意。",
            parameters={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer", "minimum": 1},
                    "confirmed": {"type": "boolean"},
                },
                "required": ["asset_id"],
                "additionalProperties": False,
            },
            handler=_delete_asset,
            write=True,
            destructive=True,
        )
    )

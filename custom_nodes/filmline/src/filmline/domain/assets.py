"""资产业务逻辑：文本 / 图片 / 视频，带来源标记（user | ai）。

本模块不依赖 aiohttp，上传的文件由调用方先落到存储层，再把相对路径交进来。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..clock import to_iso, utcnow
from ..db import session_scope
from ..db.models import Asset
from ..errors import InvalidArgument, NotFound
from .schemas import (
    AssetCounts,
    AssetKind,
    AssetList,
    AssetOut,
    AssetSource,
    AssetUpdate,
    TextAssetCreate,
)

MAX_LIST = 200
MAX_NAME = 200


def content_url(asset: Asset) -> str | None:
    if asset.kind == AssetKind.text.value:
        return None
    return f"/studio/api/assets/{asset.id}/content"


def _to_out(row: Asset) -> AssetOut:
    return AssetOut(
        id=row.id,
        project_id=row.project_id,
        episode_id=row.episode_id,
        kind=AssetKind(row.kind),
        source=AssetSource(row.source),
        name=row.name,
        text_content=row.text_content,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        content_url=content_url(row),
        meta=row.meta,
        gen_started_at=to_iso(row.gen_started_at),
        gen_elapsed_ms=row.gen_elapsed_ms,
        created_at=to_iso(row.created_at) or "",
        updated_at=to_iso(row.updated_at) or "",
    )


class AssetService:
    def __init__(self, scope=session_scope) -> None:
        self._scope = scope

    def list(
        self,
        project_id: int,
        *,
        episode_id: int | None = None,
        kind: AssetKind | None = None,
        limit: int = MAX_LIST,
        offset: int = 0,
    ) -> AssetList:
        if not 1 <= limit <= MAX_LIST:
            raise InvalidArgument(f"limit 必须介于 1 和 {MAX_LIST} 之间")

        conditions = [
            Asset.project_id == project_id,
            Asset.deleted_at.is_(None),
            Asset.episode_id.is_(None) if episode_id is None else Asset.episode_id == episode_id,
        ]
        if kind is not None:
            conditions.append(Asset.kind == kind.value)

        with self._scope() as session:
            total = session.execute(
                select(func.count()).select_from(Asset).where(*conditions)
            ).scalar_one()
            rows = (
                session.execute(
                    select(Asset)
                    .where(*conditions)
                    .order_by(Asset.created_at.desc(), Asset.id.desc())
                    .limit(limit)
                    .offset(offset)
                )
                .scalars()
                .all()
            )
            return AssetList(items=[_to_out(row) for row in rows], total=int(total))

    def counts(self, project_id: int, *, episode_id: int | None = None) -> AssetCounts:
        with self._scope() as session:
            rows = session.execute(
                select(Asset.kind, func.count())
                .where(
                    Asset.project_id == project_id,
                    Asset.deleted_at.is_(None),
                    Asset.episode_id.is_(None)
                    if episode_id is None
                    else Asset.episode_id == episode_id,
                )
                .group_by(Asset.kind)
            ).all()
        by_kind = {kind: int(count) for kind, count in rows}
        return AssetCounts(
            text=by_kind.get(AssetKind.text.value, 0),
            image=by_kind.get(AssetKind.image.value, 0),
            video=by_kind.get(AssetKind.video.value, 0),
            audio=by_kind.get(AssetKind.audio.value, 0),
        )

    def create_text(
        self, project_id: int, payload: TextAssetCreate, *, episode_id: int | None = None
    ) -> AssetOut:
        with self._scope() as session:
            row = Asset(
                project_id=project_id,
                episode_id=episode_id,
                kind=AssetKind.text.value,
                source=AssetSource.user.value,
                name=payload.name,
                text_content=payload.content,
            )
            session.add(row)
            session.flush()
            return _to_out(row)

    def create_from_file(
        self,
        project_id: int,
        *,
        name: str,
        kind: AssetKind,
        source: AssetSource,
        relative_path: str,
        mime_type: str,
        size_bytes: int,
        episode_id: int | None = None,
        meta: dict | None = None,
        gen_started_at: datetime | None = None,
        gen_elapsed_ms: int | None = None,
    ) -> AssetOut:
        clean_name = (name or "").strip() or "未命名"
        if len(clean_name) > MAX_NAME:
            clean_name = clean_name[:MAX_NAME]
        if kind is AssetKind.text:
            raise InvalidArgument("文本资产请使用文本接口创建")

        with self._scope() as session:
            row = Asset(
                project_id=project_id,
                episode_id=episode_id,
                kind=kind.value,
                source=source.value,
                name=clean_name,
                file_path=relative_path,
                mime_type=mime_type,
                size_bytes=size_bytes,
                meta=meta,
                gen_started_at=gen_started_at,
                gen_elapsed_ms=gen_elapsed_ms,
            )
            session.add(row)
            session.flush()
            return _to_out(row)

    def resolve_ref_paths(
        self,
        project_id: int,
        asset_ids: list[int],
        *,
        limit: int,
        label: str = "参考图",
    ) -> list[str]:
        """把参考图 / 首尾帧 id 解析成存储路径，并校验归属与类型。"""
        if not asset_ids:
            return []
        if len(asset_ids) > limit:
            raise InvalidArgument(f"{label}最多 {limit} 张")
        if len(set(asset_ids)) != len(asset_ids):
            raise InvalidArgument(f"{label}有重复")

        with self._scope() as session:
            rows = (
                session.execute(
                    select(Asset).where(
                        Asset.id.in_(asset_ids), Asset.deleted_at.is_(None)
                    )
                )
                .scalars()
                .all()
            )
            if len(rows) != len(asset_ids):
                raise NotFound(f"{label}不存在")

            by_id = {row.id: row for row in rows}
            paths: list[str] = []
            for asset_id in asset_ids:
                row = by_id[asset_id]
                if row.project_id != project_id:
                    raise InvalidArgument(f"{label}不属于当前项目")
                if row.kind != AssetKind.image.value:
                    raise InvalidArgument(f"{label}必须是图片资产")
                if not row.file_path:
                    raise InvalidArgument(f"{label}缺少文件")
                paths.append(row.file_path)
            return paths

    def get(self, asset_id: int) -> AssetOut:
        with self._scope() as session:
            return _to_out(self._find(session, asset_id))

    def update(self, asset_id: int, payload: AssetUpdate) -> AssetOut:
        changes = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            raise InvalidArgument("没有需要更新的字段")

        with self._scope() as session:
            row = self._find(session, asset_id)
            if "text_content" in changes and row.kind != AssetKind.text.value:
                raise InvalidArgument("只有文本资产可以修改内容")
            for field, value in changes.items():
                setattr(row, field, value)
            session.flush()
            return _to_out(row)

    def get_row_for_content(self, asset_id: int) -> tuple[str, str]:
        """返回（相对路径, mime），供文件下载使用。"""
        with self._scope() as session:
            row = self._find(session, asset_id)
            if not row.file_path:
                raise NotFound("该资产没有文件内容")
            return row.file_path, row.mime_type or "application/octet-stream"

    def delete(self, asset_id: int) -> None:
        with self._scope() as session:
            row = self._find(session, asset_id)
            row.deleted_at = utcnow()
            session.flush()

    @staticmethod
    def _find(session: Session, asset_id: int) -> Asset:
        row = session.get(Asset, asset_id)
        if row is None or row.deleted_at is not None:
            raise NotFound(f"资产不存在: {asset_id}")
        return row

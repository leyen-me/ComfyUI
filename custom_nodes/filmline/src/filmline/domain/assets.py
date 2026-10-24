"""资产业务逻辑：文本 / 图片 / 视频，带来源标记（user | ai）。

本模块不依赖 aiohttp，上传的文件由调用方先落到存储层，再把相对路径交进来。
"""

from __future__ import annotations

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
        kind=AssetKind(row.kind),
        source=AssetSource(row.source),
        name=row.name,
        text_content=row.text_content,
        mime_type=row.mime_type,
        size_bytes=row.size_bytes,
        content_url=content_url(row),
        meta=row.meta,
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
        kind: AssetKind | None = None,
        limit: int = MAX_LIST,
        offset: int = 0,
    ) -> AssetList:
        if not 1 <= limit <= MAX_LIST:
            raise InvalidArgument(f"limit 必须介于 1 和 {MAX_LIST} 之间")

        conditions = [Asset.project_id == project_id, Asset.deleted_at.is_(None)]
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

    def counts(self, project_id: int) -> AssetCounts:
        with self._scope() as session:
            rows = session.execute(
                select(Asset.kind, func.count())
                .where(Asset.project_id == project_id, Asset.deleted_at.is_(None))
                .group_by(Asset.kind)
            ).all()
        by_kind = {kind: int(count) for kind, count in rows}
        return AssetCounts(
            text=by_kind.get(AssetKind.text.value, 0),
            image=by_kind.get(AssetKind.image.value, 0),
            video=by_kind.get(AssetKind.video.value, 0),
        )

    def create_text(self, project_id: int, payload: TextAssetCreate) -> AssetOut:
        with self._scope() as session:
            row = Asset(
                project_id=project_id,
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
        meta: dict | None = None,
    ) -> AssetOut:
        clean_name = (name or "").strip() or "未命名"
        if len(clean_name) > MAX_NAME:
            clean_name = clean_name[:MAX_NAME]
        if kind is AssetKind.text:
            raise InvalidArgument("文本资产请使用文本接口创建")

        with self._scope() as session:
            row = Asset(
                project_id=project_id,
                kind=kind.value,
                source=source.value,
                name=clean_name,
                file_path=relative_path,
                mime_type=mime_type,
                size_bytes=size_bytes,
                meta=meta,
            )
            session.add(row)
            session.flush()
            return _to_out(row)

    def get(self, asset_id: int) -> AssetOut:
        with self._scope() as session:
            return _to_out(self._find(session, asset_id))

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

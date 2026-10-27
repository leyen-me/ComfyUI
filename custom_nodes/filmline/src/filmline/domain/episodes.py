"""分集业务逻辑。"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import events
from ..clock import to_iso, utcnow
from ..db import session_scope
from ..db.models import Episode
from ..errors import InvalidArgument, NotFound
from .schemas import EpisodeCreate, EpisodeOut, EpisodeUpdate


def _to_out(row: Episode) -> EpisodeOut:
    return EpisodeOut(
        id=row.id,
        project_id=row.project_id,
        number=row.number,
        code=row.code,
        title=row.title,
        synopsis=row.synopsis,
        created_at=to_iso(row.created_at) or "",
        updated_at=to_iso(row.updated_at) or "",
    )


class EpisodeService:
    def __init__(self, scope=session_scope) -> None:
        self._scope = scope

    def list(self, project_id: int) -> list[EpisodeOut]:
        with self._scope() as session:
            rows = (
                session.execute(
                    select(Episode)
                    .where(Episode.project_id == project_id, Episode.deleted_at.is_(None))
                    .order_by(Episode.sort_index.asc(), Episode.number.asc())
                )
                .scalars()
                .all()
            )
            return [_to_out(row) for row in rows]

    def get_in_project(self, project_id: int, code: str) -> EpisodeOut:
        with self._scope() as session:
            return _to_out(self._find(db_session=session, project_id=project_id, code=code))

    def create(self, project_id: int, payload: EpisodeCreate) -> EpisodeOut:
        with self._scope() as session:
            # 集号取历史最大值 +1，删集后不复用编号
            number = (
                session.execute(
                    select(func.coalesce(func.max(Episode.number), 0)).where(
                        Episode.project_id == project_id
                    )
                ).scalar_one()
                + 1
            )
            sort_index = (
                session.execute(
                    select(func.coalesce(func.max(Episode.sort_index), 0)).where(
                        Episode.project_id == project_id
                    )
                ).scalar_one()
                + 1
            )
            title = (payload.title or "").strip() or f"第 {number} 集"

            row = Episode(
                project_id=project_id,
                number=number,
                code=f"EP{number:02d}",
                title=title,
                synopsis=payload.synopsis,
                sort_index=sort_index,
            )
            session.add(row)
            session.flush()
            result = _to_out(row)
            events.record(
                session,
                events.EPISODES,
                action="created",
                project_id=project_id,
                episode_id=row.id,
            )
            return result

    def update(self, episode_id: int, payload: EpisodeUpdate) -> EpisodeOut:
        changes = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            raise InvalidArgument("没有需要更新的字段")

        with self._scope() as session:
            row = self._find(db_session=session, episode_id=episode_id)
            for field, value in changes.items():
                setattr(row, field, value)
            session.flush()
            result = _to_out(row)
            events.record(
                session,
                events.EPISODES,
                action="updated",
                project_id=row.project_id,
                episode_id=row.id,
            )
            return result

    def delete(self, episode_id: int) -> None:
        """只软删分集本身；其下资产保留，恢复分集后仍可用。"""
        with self._scope() as session:
            row = self._find(db_session=session, episode_id=episode_id)
            row.deleted_at = utcnow()
            session.flush()
            events.record(
                session,
                events.EPISODES,
                action="deleted",
                project_id=row.project_id,
                episode_id=row.id,
            )

    def reorder(self, project_id: int, ids: list[int]) -> None:
        if len(set(ids)) != len(ids):
            raise InvalidArgument("排序列表中包含重复分集")

        with self._scope() as session:
            rows = (
                session.execute(
                    select(Episode).where(
                        Episode.project_id == project_id,
                        Episode.deleted_at.is_(None),
                        Episode.id.in_(ids),
                    )
                )
                .scalars()
                .all()
            )
            if len(rows) != len(ids):
                raise InvalidArgument("排序列表中包含不存在或已删除的分集")

            total = session.execute(
                select(func.count())
                .select_from(Episode)
                .where(Episode.project_id == project_id, Episode.deleted_at.is_(None))
            ).scalar_one()
            if total != len(ids):
                raise InvalidArgument(f"排序列表需覆盖全部 {total} 集")

            by_id = {row.id: row for row in rows}
            for index, episode_id in enumerate(ids):
                by_id[episode_id].sort_index = index
            session.flush()
            events.record(
                session,
                events.EPISODES,
                action="reordered",
                project_id=project_id,
            )

    # ---------------------------------------------------------------- 内部
    @staticmethod
    def _find(
        *,
        db_session: Session,
        project_id: int | None = None,
        code: str | None = None,
        episode_id: int | None = None,
    ) -> Episode:
        stmt = select(Episode).where(Episode.deleted_at.is_(None))
        if episode_id is not None:
            stmt = stmt.where(Episode.id == episode_id)
        else:
            stmt = stmt.where(
                Episode.project_id == project_id,
                Episode.code == str(code).strip().upper(),
            )
        row = db_session.execute(stmt).scalar_one_or_none()
        if row is None:
            raise NotFound(f"分集不存在: {episode_id if episode_id is not None else code}")
        return row

    def resolve_id(self, project_id: int, code: str) -> int:
        """把 EP01 之类的编号解析成主键（资产接口需要）。"""
        with self._scope() as session:
            return self._find(db_session=session, project_id=project_id, code=code).id

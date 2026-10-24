"""项目 CRUD 业务逻辑。

本模块不依赖 aiohttp / ComfyUI，可脱离服务进程单独测试。
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..clock import to_iso, utcnow
from ..db import session_scope
from ..db.models import Project
from ..errors import InvalidArgument, NotFound
from .schemas import ProjectCreate, ProjectList, ProjectOut, ProjectUpdate

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _to_out(row: Project) -> ProjectOut:
    return ProjectOut(
        id=row.id,
        code=row.code,
        name=row.name,
        description=row.description,
        created_at=to_iso(row.created_at) or "",
        updated_at=to_iso(row.updated_at) or "",
    )


class ProjectService:
    def __init__(self, scope=session_scope) -> None:
        self._scope = scope

    # ---------------------------------------------------------------- 查询
    def list(
        self,
        *,
        q: str | None = None,
        limit: int = DEFAULT_LIMIT,
        offset: int = 0,
    ) -> ProjectList:
        if not 1 <= limit <= MAX_LIMIT:
            raise InvalidArgument(f"limit 必须介于 1 和 {MAX_LIMIT} 之间")
        if offset < 0:
            raise InvalidArgument("offset 不能为负数")

        conditions = [Project.deleted_at.is_(None)]
        if q:
            needle = f"%{_escape_like(q)}%"
            conditions.append(
                or_(
                    Project.name.ilike(needle, escape="\\"),
                    Project.code.ilike(needle, escape="\\"),
                )
            )

        with self._scope() as session:
            total = session.execute(
                select(func.count()).select_from(Project).where(*conditions)
            ).scalar_one()
            rows = (
                session.execute(
                    select(Project)
                    .where(*conditions)
                    .order_by(Project.sort_index.asc(), Project.id.asc())
                    .limit(limit)
                    .offset(offset)
                )
                .scalars()
                .all()
            )
            return ProjectList(
                items=[_to_out(row) for row in rows],
                total=int(total),
                limit=limit,
                offset=offset,
            )

    def get(self, ref: str | int) -> ProjectOut:
        with self._scope() as session:
            return _to_out(self._find(session, ref))

    # ---------------------------------------------------------------- 写入
    def create(self, payload: ProjectCreate) -> ProjectOut:
        """编号由系统生成，不接受外部输入；新项目排在最后。"""
        with self._scope() as session:
            next_index = (
                session.execute(select(func.coalesce(func.max(Project.sort_index), 0))).scalar_one()
                + 1
            )
            row = Project(
                # 临时唯一值，拿到自增 id 后再生成正式编号，避免并发下的编号竞争
                code=f"pending-{uuid4().hex}",
                name=payload.name,
                description=payload.description,
                sort_index=next_index,
            )
            session.add(row)
            try:
                session.flush()
            except IntegrityError as exc:
                raise InvalidArgument("项目创建失败，请重试") from exc

            row.code = f"PRJ-{row.id:04d}"
            session.flush()
            return _to_out(row)

    def update(self, ref: str | int, payload: ProjectUpdate) -> ProjectOut:
        changes = payload.model_dump(exclude_unset=True, exclude_none=True)
        if not changes:
            raise InvalidArgument("没有需要更新的字段")

        with self._scope() as session:
            row = self._find(session, ref)
            for field, value in changes.items():
                setattr(row, field, value)
            session.flush()
            return _to_out(row)

    def delete(self, ref: str | int) -> None:
        """软删除：素材与渲染记录可能仍引用该项目。"""
        with self._scope() as session:
            row = self._find(session, ref)
            row.deleted_at = utcnow()
            session.flush()

    def reorder(self, ids: list[int]) -> None:
        """按给定 id 顺序重写位置。必须覆盖全部未删除项目，避免顺序错乱。"""
        if len(set(ids)) != len(ids):
            raise InvalidArgument("排序列表中包含重复项目")

        with self._scope() as session:
            rows = (
                session.execute(
                    select(Project).where(Project.deleted_at.is_(None), Project.id.in_(ids))
                )
                .scalars()
                .all()
            )
            if len(rows) != len(ids):
                raise InvalidArgument("排序列表中包含不存在或已删除的项目")

            total = session.execute(
                select(func.count()).select_from(Project).where(Project.deleted_at.is_(None))
            ).scalar_one()
            if total != len(ids):
                raise InvalidArgument(f"排序列表需覆盖全部 {total} 个项目")

            by_id = {row.id: row for row in rows}
            for index, project_id in enumerate(ids):
                by_id[project_id].sort_index = index
            session.flush()

    # ---------------------------------------------------------------- 内部
    @staticmethod
    def _find(session: Session, ref: str | int) -> Project:
        stmt = select(Project).where(Project.deleted_at.is_(None))
        if isinstance(ref, int) or str(ref).isdigit():
            stmt = stmt.where(Project.id == int(ref))
        else:
            stmt = stmt.where(Project.code == str(ref).strip().upper())
        row = session.execute(stmt).scalar_one_or_none()
        if row is None:
            raise NotFound(f"项目不存在: {ref}")
        return row

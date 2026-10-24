"""生成任务：持久化队列状态，供刷新/多人共享/重启恢复。

真正的执行状态以 ComfyUI 的 prompt_id 为准；本表只负责把
project / kind / 参数 / 产物对应起来。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select

from ..clock import to_iso, utcnow
from ..db import session_scope
from ..db.models import Episode, GenerationTask, Project
from ..errors import NotFound

ACTIVE_STATUSES = ("queued", "running")
TERMINAL_STATUSES = ("succeeded", "failed", "cancelled")


@dataclass(frozen=True)
class TaskOut:
    id: int
    client_id: str
    prompt_id: str | None
    project_id: int
    project_code: str
    project_name: str
    episode_id: int | None
    episode_code: str | None
    kind: str
    status: str
    prompt_excerpt: str
    created_at: str
    started_at: str | None
    finished_at: str | None
    elapsed_ms: int | None
    error: str | None
    asset_ids: list[int]


@dataclass(frozen=True)
class TaskRecord:
    """runner 内部使用：包含恢复/提交需要的完整 payload。"""

    id: int
    client_id: str
    prompt_id: str | None
    project_id: int
    episode_id: int | None
    kind: str
    status: str
    payload: dict
    created_at: datetime
    started_at: datetime | None


def _to_out(
    row: GenerationTask,
    project_code: str,
    project_name: str,
    episode_code: str | None,
) -> TaskOut:
    return TaskOut(
        id=row.id,
        client_id=row.client_id,
        prompt_id=row.prompt_id,
        project_id=row.project_id,
        project_code=project_code,
        project_name=project_name,
        episode_id=row.episode_id,
        episode_code=episode_code,
        kind=row.kind,
        status=row.status,
        prompt_excerpt=row.prompt_excerpt,
        created_at=to_iso(row.created_at) or "",
        started_at=to_iso(row.started_at),
        finished_at=to_iso(row.finished_at),
        elapsed_ms=row.elapsed_ms,
        error=row.error,
        asset_ids=row.asset_ids or [],
    )


class TaskService:
    def create(
        self,
        *,
        project_id: int,
        episode_id: int | None,
        kind: str,
        prompt: str,
        payload: dict,
    ) -> TaskOut:
        with session_scope() as session:
            row = GenerationTask(
                client_id=uuid4().hex,
                project_id=project_id,
                episode_id=episode_id,
                kind=kind,
                status="queued",
                prompt_excerpt=prompt.strip()[:160],
                payload=payload,
            )
            session.add(row)
            session.flush()
            project = session.get(Project, project_id)
            episode = session.get(Episode, episode_id) if episode_id else None
            if project is None:
                raise NotFound("项目不存在")
            return _to_out(row, project.code, project.name, episode.code if episode else None)

    def get(self, task_id: int) -> TaskOut:
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                raise NotFound("任务不存在")
            project = session.get(Project, row.project_id)
            episode = session.get(Episode, row.episode_id) if row.episode_id else None
            return _to_out(
                row,
                project.code if project else "",
                project.name if project else "",
                episode.code if episode else None,
            )

    def list(self, *, limit: int = 30, active_only: bool = False) -> list[TaskOut]:
        with session_scope() as session:
            query = (
                select(GenerationTask, Project.code, Project.name, Episode.code)
                .join(Project, Project.id == GenerationTask.project_id)
                .outerjoin(Episode, Episode.id == GenerationTask.episode_id)
                .where(Project.deleted_at.is_(None))
            )
            if active_only:
                query = query.where(GenerationTask.status.in_(ACTIVE_STATUSES))
            query = query.order_by(GenerationTask.created_at.desc()).limit(limit)
            return [
                _to_out(row, project_code, project_name, episode_code)
                for row, project_code, project_name, episode_code in session.execute(query).all()
            ]

    def get_record(self, task_id: int) -> TaskRecord:
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                raise NotFound("任务不存在")
            return TaskRecord(
                id=row.id,
                client_id=row.client_id,
                prompt_id=row.prompt_id,
                project_id=row.project_id,
                episode_id=row.episode_id,
                kind=row.kind,
                status=row.status,
                payload=row.payload,
                created_at=row.created_at,
                started_at=row.started_at,
            )

    def recoverable(self) -> list[TaskRecord]:
        with session_scope() as session:
            rows = (
                session.execute(
                    select(GenerationTask).where(
                        GenerationTask.status.in_(ACTIVE_STATUSES)
                    )
                )
                .scalars()
                .all()
            )
            return [
                TaskRecord(
                    id=row.id,
                    client_id=row.client_id,
                    prompt_id=row.prompt_id,
                    project_id=row.project_id,
                    episode_id=row.episode_id,
                    kind=row.kind,
                    status=row.status,
                    payload=row.payload,
                    created_at=row.created_at,
                    started_at=row.started_at,
                )
                for row in rows
            ]

    def mark_running(
        self, task_id: int, *, prompt_id: str, started_at: datetime | None = None
    ) -> None:
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                raise NotFound("任务不存在")
            row.prompt_id = prompt_id
            row.status = "running"
            row.started_at = row.started_at or started_at or utcnow()
            row.error = None

    def mark_succeeded(
        self,
        task_id: int,
        *,
        asset_ids: list[int],
        elapsed_ms: int,
        finished_at: datetime | None = None,
    ) -> None:
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                return
            row.status = "succeeded"
            row.asset_ids = asset_ids
            row.elapsed_ms = elapsed_ms
            row.finished_at = finished_at or utcnow()
            row.error = None

    def mark_failed(
        self, task_id: int, *, error: str, finished_at: datetime | None = None
    ) -> None:
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                return
            row.status = "failed"
            row.error = error[:2000]
            row.finished_at = finished_at or utcnow()

    def mark_cancelled(self, task_id: int, *, finished_at: datetime | None = None) -> None:
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                return
            row.status = "cancelled"
            row.finished_at = finished_at or utcnow()

    def active_prompt_ids(self) -> set[str]:
        with session_scope() as session:
            rows = session.execute(
                select(GenerationTask.prompt_id).where(
                    GenerationTask.status.in_(ACTIVE_STATUSES),
                    GenerationTask.prompt_id.is_not(None),
                )
            ).scalars()
            return {prompt_id for prompt_id in rows if prompt_id}

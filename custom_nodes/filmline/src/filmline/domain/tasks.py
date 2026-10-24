"""生成任务：持久化队列状态，供刷新/多人共享/重启恢复。

真正的执行状态以 ComfyUI 的 prompt_id 为准；本表只负责把
project / kind / 参数 / 产物对应起来。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete, select

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
    client_label: str
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
        client_label=str((row.payload or {}).get("client_label") or ""),
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
    ) -> bool:
        """只在任务仍为 queued 时进入 running；取消/终态不会被覆盖。"""
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                raise NotFound("任务不存在")
            if row.status != "queued":
                return False
            row.prompt_id = prompt_id
            row.status = "running"
            row.started_at = row.started_at or started_at or utcnow()
            row.error = None
            return True

    def replace_prompt(self, task_id: int, *, prompt_id: str) -> bool:
        """任务丢失（例如 ComfyUI 重启）时，换一个新的 prompt_id 继续。"""
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                raise NotFound("任务不存在")
            if row.status != "running":
                return False
            row.prompt_id = prompt_id
            row.started_at = row.started_at or utcnow()
            row.error = None
            return True

    def requeue_lost(self, task_id: int) -> bool:
        """把丢失的 running/failed 任务重置为 queued，交给 runner 重提。"""
        with session_scope() as session:
            row = session.get(GenerationTask, task_id)
            if row is None:
                return False
            if row.status == "succeeded":
                return False
            row.status = "queued"
            row.prompt_id = None
            row.started_at = None
            row.finished_at = None
            row.elapsed_ms = None
            row.asset_ids = None
            row.error = None
            return True

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
            if row.status in TERMINAL_STATUSES:
                return
            row.status = "cancelled"
            row.finished_at = finished_at or utcnow()

    def prune(self, *, keep_days: int = 30, keep_count: int = 200) -> int:
        """清理终态任务：超过保留天数，或超出最近 N 条。进行中任务永不删除。"""
        cutoff = utcnow() - timedelta(days=max(1, keep_days))
        deleted = 0
        with session_scope() as session:
            old = session.execute(
                delete(GenerationTask).where(
                    GenerationTask.status.in_(TERMINAL_STATUSES),
                    GenerationTask.finished_at.is_not(None),
                    GenerationTask.finished_at < cutoff,
                )
            )
            deleted += old.rowcount or 0

            keep_ids = (
                select(GenerationTask.id)
                .where(GenerationTask.status.in_(TERMINAL_STATUSES))
                .order_by(GenerationTask.finished_at.desc())
                .limit(max(1, keep_count))
            )
            extra = session.execute(
                delete(GenerationTask).where(
                    GenerationTask.status.in_(TERMINAL_STATUSES),
                    GenerationTask.id.not_in(keep_ids),
                )
            )
            deleted += extra.rowcount or 0
        return deleted

    def active_prompt_ids(self) -> set[str]:
        with session_scope() as session:
            rows = session.execute(
                select(GenerationTask.prompt_id).where(
                    GenerationTask.status.in_(ACTIVE_STATUSES),
                    GenerationTask.prompt_id.is_not(None),
                )
            ).scalars()
            return {prompt_id for prompt_id in rows if prompt_id}

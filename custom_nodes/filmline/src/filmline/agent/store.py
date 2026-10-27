"""Agent 持久化：会话、上下文消息、事件日志、工具账本、任务关注。

所有序号分配都在一个进程级锁里做，SQLite 单写者语义下最简单可靠。
写入的消息/事件都是原文，读取时不做任何规范化。
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Iterable

from sqlalchemy import func, select, text

from ..clock import to_iso, utcnow
from ..db import session_scope
from ..db.models import (
    AgentEvent,
    AgentMessage,
    AgentSession,
    AgentTaskWatch,
    AgentToolLedger,
)
from ..errors import NotFound

_lock = threading.Lock()

STATUSES = ("idle", "running", "waiting_input", "paused", "interrupted", "error")


def _dump(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


@dataclass(frozen=True)
class SessionInfo:
    id: int
    project_id: int
    title: str
    status: str
    model: str
    context_window: int
    last_seq: int
    turn: int
    usage: dict | None
    created_at: str
    updated_at: str

    @property
    def running(self) -> bool:
        return self.status in ("running", "waiting_input")


def _session_out(row: AgentSession) -> SessionInfo:
    return SessionInfo(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        status=row.status,
        model=row.model,
        context_window=row.context_window,
        last_seq=row.last_seq,
        turn=row.turn,
        usage=row.usage,
        created_at=to_iso(row.created_at) or "",
        updated_at=to_iso(row.updated_at) or "",
    )


def create_session(project_id: int, *, title: str, model: str, context_window: int) -> SessionInfo:
    with _lock, session_scope() as session:
        row = AgentSession(
            project_id=project_id,
            title=title,
            status="idle",
            model=model,
            context_window=context_window,
        )
        session.add(row)
        session.flush()
        return _session_out(row)


def list_sessions(project_id: int, *, limit: int = 50) -> list[SessionInfo]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentSession)
                .where(
                    AgentSession.project_id == project_id,
                    AgentSession.deleted_at.is_(None),
                )
                .order_by(AgentSession.updated_at.desc(), AgentSession.id.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return [_session_out(row) for row in rows]


def get_session(session_id: int) -> SessionInfo:
    with session_scope() as session:
        return _session_out(_find(session, session_id))


def _find(session, session_id: int) -> AgentSession:
    row = session.get(AgentSession, session_id)
    if row is None or row.deleted_at is not None:
        raise NotFound("会话不存在")
    return row


def update_session(session_id: int, **fields: Any) -> None:
    allowed = {
        "title",
        "status",
        "model",
        "context_window",
        "usage",
        "turn",
    }
    changes = {key: value for key, value in fields.items() if key in allowed}
    if not changes:
        return
    changes["updated_at"] = utcnow()
    with _lock, session_scope() as session:
        row = _find(session, session_id)
        for key, value in changes.items():
            setattr(row, key, value)


def delete_session(session_id: int) -> None:
    with _lock, session_scope() as session:
        _find(session, session_id).deleted_at = utcnow()


def set_status(session_id: int, status: str) -> None:
    if status not in STATUSES:
        raise ValueError(f"未知会话状态: {status}")
    update_session(session_id, status=status)


def _next_seq(session, session_id: int, column: str) -> int:
    spelled = "last_seq" if column == "last_seq" else "last_message_seq"
    session.execute(
        text(
            f"UPDATE agent_sessions SET {spelled} = {spelled} + 1 "
            "WHERE id = :session_id"
        ),
        {"session_id": session_id},
    )
    return int(
        session.execute(
            text(f"SELECT {spelled} FROM agent_sessions WHERE id = :session_id"),
            {"session_id": session_id},
        ).scalar_one()
    )


def append_event(session_id: int, event_type: str, data: dict[str, Any]) -> dict:
    """追加一条事件并返回可直接推送的完整事件（含 seq）。"""
    with _lock, session_scope() as session:
        seq = _next_seq(session, session_id, "last_seq")
        raw = _dump(data)
        session.add(
            AgentEvent(session_id=session_id, seq=seq, type=event_type, data=raw)
        )
        session.execute(
            text("UPDATE agent_sessions SET updated_at = :now WHERE id = :session_id"),
            {"now": utcnow(), "session_id": session_id},
        )
        return {
            "seq": seq,
            "type": event_type,
            "data": data,
            "ts": to_iso(utcnow()),
        }


def append_message(
    session_id: int,
    *,
    turn: int,
    role: str,
    content: str = "",
    reasoning: str = "",
    tool_calls_raw: str | None = None,
    tool_call_id: str | None = None,
    tool_name: str | None = None,
    meta: dict | None = None,
) -> int:
    with _lock, session_scope() as session:
        seq = _next_seq(session, session_id, "last_message_seq")
        session.add(
            AgentMessage(
                session_id=session_id,
                seq=seq,
                turn=turn,
                role=role,
                content=content,
                reasoning=reasoning,
                tool_calls_raw=tool_calls_raw,
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                meta=meta,
            )
        )
        session.execute(
            text("UPDATE agent_sessions SET updated_at = :now WHERE id = :session_id"),
            {"now": utcnow(), "session_id": session_id},
        )
        return seq


@dataclass(frozen=True)
class StoredMessage:
    seq: int
    turn: int
    role: str
    content: str
    reasoning: str
    tool_calls_raw: str | None
    tool_call_id: str | None
    tool_name: str | None
    meta: dict | None


def list_messages(session_id: int) -> list[StoredMessage]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentMessage)
                .where(AgentMessage.session_id == session_id)
                .order_by(AgentMessage.seq)
            )
            .scalars()
            .all()
        )
        return [
            StoredMessage(
                seq=row.seq,
                turn=row.turn,
                role=row.role,
                content=row.content,
                reasoning=row.reasoning,
                tool_calls_raw=row.tool_calls_raw,
                tool_call_id=row.tool_call_id,
                tool_name=row.tool_name,
                meta=row.meta,
            )
            for row in rows
        ]


def list_events(session_id: int, *, after: int = 0, limit: int = 5000) -> list[dict]:
    with session_scope() as session:
        rows = (
            session.execute(
                select(AgentEvent)
                .where(AgentEvent.session_id == session_id, AgentEvent.seq > after)
                .order_by(AgentEvent.seq)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        result = []
        for row in rows:
            try:
                data = json.loads(row.data) if row.data else {}
            except json.JSONDecodeError:
                data = {"raw": row.data}
            result.append(
                {
                    "seq": row.seq,
                    "type": row.type,
                    "data": data,
                    "ts": to_iso(row.created_at),
                }
            )
        return result


def latest_seq(session_id: int) -> int:
    with session_scope() as session:
        return int(
            session.execute(
                select(AgentSession.last_seq).where(AgentSession.id == session_id)
            ).scalar_one()
        )


# ---------------------------------------------------------------------------
# 工具账本
# ---------------------------------------------------------------------------


def ledger_start(session_id: int, tool_call_id: str, tool_name: str) -> bool:
    """登记一次工具执行；返回 False 表示已经执行过（恢复时跳过）。"""
    with _lock, session_scope() as session:
        existing = session.execute(
            select(AgentToolLedger).where(
                AgentToolLedger.session_id == session_id,
                AgentToolLedger.tool_call_id == tool_call_id,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return False
        session.add(
            AgentToolLedger(
                session_id=session_id,
                tool_call_id=tool_call_id,
                tool_name=tool_name,
                status="running",
            )
        )
        return True


def ledger_finish(
    session_id: int, tool_call_id: str, *, status: str, result_raw: str
) -> None:
    with _lock, session_scope() as session:
        row = session.execute(
            select(AgentToolLedger).where(
                AgentToolLedger.session_id == session_id,
                AgentToolLedger.tool_call_id == tool_call_id,
            )
        ).scalar_one_or_none()
        if row is None:
            return
        row.status = status
        row.result_raw = result_raw
        row.finished_at = utcnow()


def ledger_result(session_id: int, tool_call_id: str) -> tuple[str, str] | None:
    with session_scope() as session:
        row = session.execute(
            select(AgentToolLedger).where(
                AgentToolLedger.session_id == session_id,
                AgentToolLedger.tool_call_id == tool_call_id,
            )
        ).scalar_one_or_none()
        if row is None or row.result_raw is None:
            return None
        return row.status, row.result_raw


# ---------------------------------------------------------------------------
# 生成任务关注 / 通知
# ---------------------------------------------------------------------------


def watch_task(session_id: int, task_id: int) -> None:
    with _lock, session_scope() as session:
        exists = session.execute(
            select(AgentTaskWatch).where(
                AgentTaskWatch.session_id == session_id,
                AgentTaskWatch.task_id == task_id,
            )
        ).scalar_one_or_none()
        if exists is None:
            session.add(AgentTaskWatch(session_id=session_id, task_id=task_id))


def pending_watches() -> list[tuple[int, int]]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentTaskWatch.session_id, AgentTaskWatch.task_id).where(
                AgentTaskWatch.notified_at.is_(None)
            )
        ).all()
        return [(int(row[0]), int(row[1])) for row in rows]


def mark_watched(session_id: int, task_id: int) -> None:
    with _lock, session_scope() as session:
        row = session.execute(
            select(AgentTaskWatch).where(
                AgentTaskWatch.session_id == session_id,
                AgentTaskWatch.task_id == task_id,
            )
        ).scalar_one_or_none()
        if row is not None:
            row.notified_at = utcnow()


def sessions_with_pending_watch() -> list[int]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentTaskWatch.session_id)
            .where(AgentTaskWatch.notified_at.is_(None))
            .distinct()
        ).all()
        return [int(row[0]) for row in rows]


# ---------------------------------------------------------------------------
# 崩溃恢复
# ---------------------------------------------------------------------------


def mark_interrupted() -> list[int]:
    """进程启动时把上次没跑完的会话标成 interrupted，等待用户继续。

    返回会话 id，调用方据此补发 ``session.status`` 事件；否则重连的客户端
    回放历史时只能看到旧的 running，界面会一直显示“运行中”。
    """
    with _lock, session_scope() as session:
        rows = (
            session.execute(
                select(AgentSession).where(
                    AgentSession.status.in_(("running", "waiting_input")),
                    AgentSession.deleted_at.is_(None),
                )
            )
            .scalars()
            .all()
        )
        ids = [row.id for row in rows]
        for row in rows:
            row.status = "interrupted"
        return ids


def pending_tool_calls(session_id: int) -> list[tuple[str, str]]:
    """存在 assistant tool_call 但缺少对应 tool 结果的调用。"""
    with session_scope() as session:
        assistant_rows = (
            session.execute(
                select(AgentMessage)
                .where(
                    AgentMessage.session_id == session_id,
                    AgentMessage.role == "assistant",
                    AgentMessage.tool_calls_raw.is_not(None),
                )
                .order_by(AgentMessage.seq)
            )
            .scalars()
            .all()
        )
        answered = {
            str(row[0])
            for row in session.execute(
                select(AgentMessage.tool_call_id).where(
                    AgentMessage.session_id == session_id,
                    AgentMessage.role == "tool",
                )
            ).all()
            if row[0]
        }
        pending: list[tuple[str, str]] = []
        for row in assistant_rows:
            try:
                calls = json.loads(row.tool_calls_raw or "[]")
            except json.JSONDecodeError:
                continue
            for call in calls if isinstance(calls, list) else []:
                if not isinstance(call, dict):
                    continue
                call_id = str(call.get("id") or "")
                name = str((call.get("function") or {}).get("name") or "")
                if call_id and call_id not in answered:
                    pending.append((call_id, name))
        return pending


def assistant_steps_in_turn(session_id: int, turn: int) -> int:
    """该轮已经落库的 assistant step 数，用于恢复后继续编号、避免前端串步。"""
    with session_scope() as session:
        return int(
            session.execute(
                select(func.count())
                .select_from(AgentMessage)
                .where(
                    AgentMessage.session_id == session_id,
                    AgentMessage.turn == turn,
                    AgentMessage.role == "assistant",
                )
            ).scalar_one()
        )


def count_messages(session_id: int) -> int:
    with session_scope() as session:
        return int(
            session.execute(
                select(func.count())
                .select_from(AgentMessage)
                .where(AgentMessage.session_id == session_id)
            ).scalar_one()
        )


def first_user_content(session_id: int) -> str:
    with session_scope() as session:
        row = session.execute(
            select(AgentMessage.content)
            .where(
                AgentMessage.session_id == session_id,
                AgentMessage.role == "user",
                AgentMessage.content != "",
            )
            .order_by(AgentMessage.seq)
            .limit(1)
        ).scalar_one_or_none()
        return str(row or "")


def latest_usage(session_id: int) -> dict | None:
    with session_scope() as session:
        row = session.get(AgentSession, session_id)
        return dict(row.usage) if row is not None and row.usage else None


def iter_session_ids() -> Iterable[int]:
    with session_scope() as session:
        rows = session.execute(
            select(AgentSession.id).where(AgentSession.deleted_at.is_(None))
        ).all()
        return [int(row[0]) for row in rows]

"""数据库模型。

约定：
* 时间一律存朴素 UTC（见 ``filmline.clock``）；
* 面向影视流程的实体都做软删除（``deleted_at``），镜头/素材会长期
  被资产和渲染记录引用，硬删除会造成血缘断裂。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from ..clock import utcnow


class Base(DeclarativeBase):
    pass


class Project(Base):
    """项目（一部影片 / 一部剧）。"""

    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 自动生成的编号（PRJ-0001），供文件命名与人工沟通引用
    code: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    description: Mapped[str] = mapped_column(Text, default="", server_default="")
    # 手动拖拽排序的位置，越小越靠前
    sort_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0", index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class Asset(Base):
    """项目资产：文本、图片、视频。

    ``source`` 记录来源，区分用户自建与 AI 生成：``user`` | ``ai``。
    """

    __tablename__ = "assets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"), index=True, nullable=False
    )
    # text | image | video
    kind: Mapped[str] = mapped_column(String(8), index=True)
    # user | ai
    source: Mapped[str] = mapped_column(String(8), index=True)
    # 为空表示项目级资产；否则属于某一集
    episode_id: Mapped[int | None] = mapped_column(
        ForeignKey("episodes.id"), nullable=True, index=True
    )

    name: Mapped[str] = mapped_column(String(200))
    text_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 相对 data/assets 的路径，便于整体迁移
    file_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 生成参数、来源工作流等扩展信息，结构随业务演进
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 生成统计：仅 AI 资产有值
    gen_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    gen_elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class GenerationTask(Base):
    """一次生成任务：刷新页面、多人共享、进程重启后都还能看到状态。"""

    __tablename__ = "generation_tasks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # 传给 ComfyUI 的 client_id，便于在队列中找回任务
    client_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    # ComfyUI prompt_id；提交成功前为空
    prompt_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"), index=True, nullable=False
    )
    episode_id: Mapped[int | None] = mapped_column(
        ForeignKey("episodes.id"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    # queued | running | succeeded | failed | cancelled
    status: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    prompt_excerpt: Mapped[str] = mapped_column(Text, default="", server_default="")
    # {graph, meta, scope, ...}；恢复/提交都从这里取
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    asset_ids: Mapped[list | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    elapsed_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )


class AgentSession(Base):
    """项目下的一个 Agent 会话；所有人共享，与分集无关。"""

    __tablename__ = "agent_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # idle | running | waiting_input | paused | interrupted | error
    status: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    model: Mapped[str] = mapped_column(String(120), default="", server_default="")
    context_window: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    # 事件与模型消息使用各自的单调序号，前端按事件序号断点续传
    last_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    last_message_seq: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    turn: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    usage: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


class AgentMessage(Base):
    """模型可见的上下文，只追加。

    ``content`` / ``reasoning`` / ``tool_calls_raw`` 保存的是模型实际看到/输出的
    原始字符串，重建请求时原样回填，避免重新序列化破坏 DeepSeek 的前缀缓存。
    """

    __tablename__ = "agent_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("agent_sessions.id"), index=True, nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    turn: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # user | assistant | tool
    role: Mapped[str] = mapped_column(String(16), nullable=False)
    content: Mapped[str] = mapped_column(Text, default="", server_default="")
    reasoning: Mapped[str] = mapped_column(Text, default="", server_default="")
    # assistant 的完整 tool_calls JSON（arguments 保持原始字符串）
    tool_calls_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    tool_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    __table_args__ = (UniqueConstraint("session_id", "seq", name="ux_agent_messages_seq"),)


class AgentEvent(Base):
    """SSE 事件日志：增量原文入库，刷新/断网后按 seq 回放。"""

    __tablename__ = "agent_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("agent_sessions.id"), index=True, nullable=False
    )
    seq: Mapped[int] = mapped_column(Integer, nullable=False)
    type: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    data: Mapped[str] = mapped_column(Text, default="", server_default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)

    __table_args__ = (UniqueConstraint("session_id", "seq", name="ux_agent_events_seq"),)


class AgentToolLedger(Base):
    """工具执行账本：同一 tool_call_id 只执行一次，崩溃恢复后不重复产生副作用。"""

    __tablename__ = "agent_tool_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("agent_sessions.id"), index=True, nullable=False
    )
    tool_call_id: Mapped[str] = mapped_column(String(80), nullable=False)
    tool_name: Mapped[str] = mapped_column(String(64), nullable=False)
    # running | ok | error | paused | cancelled | interrupted
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    result_raw: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("session_id", "tool_call_id", name="ux_agent_ledger_call"),
    )


class AgentTaskWatch(Base):
    """Agent 关注的生成任务：完成通知与定时自检都从这里取。"""

    __tablename__ = "agent_task_watch"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[int] = mapped_column(
        ForeignKey("agent_sessions.id"), index=True, nullable=False
    )
    task_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    # 完成后通知的时间；为空表示还没通知
    notified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    __table_args__ = (
        UniqueConstraint("session_id", "task_id", name="ux_agent_task_watch"),
    )


class Episode(Base):
    """分集。项目下按 number 自增编号，code 形如 EP01。"""

    __tablename__ = "episodes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id"), index=True, nullable=False
    )
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    code: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    synopsis: Mapped[str] = mapped_column(Text, default="", server_default="")
    sort_index: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

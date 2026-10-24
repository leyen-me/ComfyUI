"""数据库模型。

约定：
* 时间一律存朴素 UTC（见 ``filmline.clock``）；
* 面向影视流程的实体都做软删除（``deleted_at``），镜头/素材会长期
  被资产和渲染记录引用，硬删除会造成血缘断裂。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
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

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)


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

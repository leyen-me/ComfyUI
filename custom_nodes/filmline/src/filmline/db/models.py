"""数据库模型。

约定：
* 时间一律存朴素 UTC（见 ``filmline.clock``）；
* 面向影视流程的实体都做软删除（``deleted_at``），镜头/素材会长期
  被资产和渲染记录引用，硬删除会造成血缘断裂。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text
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

    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

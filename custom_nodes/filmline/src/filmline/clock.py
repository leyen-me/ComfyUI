"""时间工具。

SQLite 对带时区的 datetime 支持不一致，因此统一存储“朴素 UTC”，
只在对外输出时补上 ``Z`` 后缀，避免同一台机器出现两种时间语义。
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow() -> datetime:
    """当前 UTC 时间（无时区信息，用于入库）。"""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def to_iso(value: datetime | None) -> str | None:
    """入库时间 -> RFC3339 UTC 字符串。"""
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

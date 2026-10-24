"""SQLite 引擎与会话管理。

一个 ComfyUI 进程只持有一个引擎（懒加载 + 线程安全），
每次业务调用用一个短会话，避免长事务和跨线程共享 Session。
"""

from __future__ import annotations

import logging
import threading
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .. import config
from .migrations import migrate

_LOG = logging.getLogger("filmline")

_lock = threading.Lock()
_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def _apply_pragmas(dbapi_conn, _record) -> None:
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
    finally:
        cursor.close()


def _build_engine(path: Path) -> Engine:
    engine = create_engine(
        f"sqlite:///{path}",
        future=True,
        # aiohttp 的不同线程/同一个应用都会用到连接池，SQLite 连接需允许跨线程
        connect_args={"check_same_thread": False},
    )
    event.listen(engine, "connect", _apply_pragmas)
    return engine


def init(db_path: Path | None = None) -> Engine:
    """初始化（幂等）：建引擎、执行迁移。"""
    global _engine, _session_factory
    with _lock:
        if _engine is not None:
            return _engine
        path = Path(db_path) if db_path is not None else config.db_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        engine = _build_engine(path)
        version = migrate(engine)
        _engine = engine
        _session_factory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
        _LOG.info("filmline 数据库就绪: %s (schema v%s)", path, version)
        return engine


def get_engine() -> Engine:
    return _engine if _engine is not None else init()


def get_session_factory() -> sessionmaker[Session]:
    if _session_factory is None:
        init()
    assert _session_factory is not None
    return _session_factory


@contextmanager
def session_scope() -> Iterator[Session]:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except BaseException:
        session.rollback()
        raise
    finally:
        session.close()


def reset() -> None:
    """测试用：释放引擎并清空全局状态。"""
    global _engine, _session_factory
    with _lock:
        if _engine is not None:
            _engine.dispose()
        _engine = None
        _session_factory = None

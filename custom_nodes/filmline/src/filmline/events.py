"""进程内工作区变更事件。

领域服务在事务里用 :func:`record` 登记变更，``db.session_scope`` 在提交成功后
统一 :func:`flush`，再由 SSE 推送给浏览器。只用于实时刷新提示：

* 不落库、不回放，客户端重连后应做一次全量同步；
* 队列满时丢弃事件，慢客户端不能拖垮业务；
* 没有绑定事件循环时（纯单元测试）安全空操作。
"""

from __future__ import annotations

import asyncio
import logging
import threading
from typing import Any

from sqlalchemy.orm import Session

_LOG = logging.getLogger("filmline.events")

ASSETS = "assets"
EPISODES = "episodes"
PROJECT = "project"
PROJECTS = "projects"

_PENDING_KEY = "filmline.pending_changes"


class WorkspaceBus:
    """单进程发布/订阅。

    订阅与投递都在事件循环线程里执行；``publish`` 可能来自 Agent 工具或生成
    runner 的工作线程，因此统一用 ``call_soon_threadsafe`` 切回循环。
    """

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._lock = threading.Lock()

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            self._loop = loop
            self._subscribers.clear()

    def unbind(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._lock:
            if self._loop is loop:
                self._loop = None
                self._subscribers.clear()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=512)
        self._subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(queue)

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            loop = self._loop
        if loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._deliver, event)
        except RuntimeError:
            # 进程正在关闭，事件没有意义
            pass

    def _deliver(self, event: dict[str, Any]) -> None:
        for queue in tuple(self._subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # 慢客户端重连时会整体刷新，不在这里阻塞或补偿
                pass


BUS = WorkspaceBus()


def record(
    session: Session,
    kind: str,
    *,
    action: str,
    project_id: int | None = None,
    episode_id: int | None = None,
    asset_ids: list[int] | None = None,
) -> None:
    """登记一条待发事件，真正发送发生在事务提交成功之后。"""
    event: dict[str, Any] = {"type": kind, "action": action}
    if project_id is not None:
        event["project_id"] = project_id
    if episode_id is not None:
        event["episode_id"] = episode_id
    if asset_ids:
        event["asset_ids"] = list(asset_ids)
    session.info.setdefault(_PENDING_KEY, []).append(event)


def flush(session: Session) -> None:
    """提交成功后广播本事务登记的事件。任何异常都不能影响已完成的写入。"""
    pending = session.info.pop(_PENDING_KEY, None)
    if not pending:
        return
    for event in pending:
        try:
            BUS.publish(event)
        except Exception:  # pragma: no cover - 防御性兜底
            _LOG.exception("广播工作区事件失败: %s", event)


def discard(session: Session) -> None:
    """事务回滚时丢弃待发事件，避免把没有落库的变更推给前端。"""
    session.info.pop(_PENDING_KEY, None)

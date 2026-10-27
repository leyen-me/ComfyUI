"""进程内事件总线：一个会话可以有多个 SSE 订阅者。

只负责“实时”这一段，历史回放由数据库负责。订阅者掉线只会丢自己的队列，
不会影响 Agent 运行；重新连接时按 ``after`` 从库里补齐。
"""

from __future__ import annotations

import asyncio
from collections import defaultdict


class SessionBus:
    def __init__(self) -> None:
        self._subscribers: dict[int, set[asyncio.Queue[dict]]] = defaultdict(set)

    def subscribe(self, session_id: int) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=4096)
        self._subscribers[session_id].add(queue)
        return queue

    def unsubscribe(self, session_id: int, queue: asyncio.Queue[dict]) -> None:
        subscribers = self._subscribers.get(session_id)
        if not subscribers:
            return
        subscribers.discard(queue)
        if not subscribers:
            self._subscribers.pop(session_id, None)

    def publish(self, session_id: int, event: dict) -> None:
        for queue in list(self._subscribers.get(session_id, ())):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # 慢客户端不能拖垮运行；它重连时会从库里回放
                pass


BUS = SessionBus()

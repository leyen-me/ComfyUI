"""会话分支（fork）接口测试。"""

from __future__ import annotations

import asyncio

from base import ApiTestCase
from filmline.agent import store


class AgentForkApiTest(ApiTestCase):
    async def _project(self, name: str = "分支项目") -> dict:
        response = await self.client.post("/studio/api/projects", json={"name": name})
        body = await response.json()
        self.assertEqual(response.status, 201, body)
        return body["data"]

    async def _session(self, ref: str) -> dict:
        response = await self.client.post(
            f"/studio/api/projects/{ref}/agent/sessions", json={"title": "原始会话"}
        )
        body = await response.json()
        self.assertEqual(response.status, 201, body)
        return body["data"]

    def _seed_turn(
        self,
        session_id: int,
        turn: int,
        *,
        text: str,
        content: str,
        usage: dict | None = None,
    ) -> None:
        store.append_message(session_id, turn=turn, role="user", content=text)
        store.append_event(
            session_id,
            "user.message",
            {"turn": turn, "text": text, "content": text, "assets": []},
        )
        store.append_event(session_id, "run.started", {"turn": turn})
        store.append_event(session_id, "step.started", {"turn": turn, "step": 0})
        store.append_event(session_id, "content.delta", {"text": content})
        store.append_event(
            session_id,
            "step.finished",
            {"turn": turn, "step": 0, "content": content, "reasoning": "", "tool_calls": []},
        )
        store.append_message(
            session_id, turn=turn, role="assistant", content=content, reasoning=""
        )
        if usage is not None:
            store.append_event(session_id, "usage", usage)
        store.append_event(session_id, "run.finished", {"status": "done", "turn": turn})
        store.update_session(session_id, turn=turn)

    async def test_fork_copies_context_up_to_turn(self) -> None:
        project = await self._project()
        session = await self._session(project["code"])
        source_id = session["id"]

        await asyncio.to_thread(
            self._seed_turn, source_id, 1, text="第一问", content="第一答",
            usage={"total_tokens": 100, "context_window": 1000},
        )
        await asyncio.to_thread(
            self._seed_turn, source_id, 2, text="第二问", content="第二答",
            usage={"total_tokens": 200, "context_window": 1000},
        )
        await asyncio.to_thread(
            self._seed_turn, source_id, 3, text="第三问", content="第三答",
            usage={"total_tokens": 300, "context_window": 1000},
        )

        response = await self.client.post(
            f"/studio/api/agent/sessions/{source_id}/fork", json={"turn": 2}
        )
        body = await response.json()
        self.assertEqual(response.status, 201, body)
        created = body["data"]
        self.assertNotEqual(created["id"], source_id)
        self.assertEqual(created["project_id"], project["id"])
        self.assertEqual(created["turn"], 2)
        self.assertEqual(created["status"], "idle")
        self.assertIn("第2轮分支", created["title"])
        self.assertEqual(created["usage"], {"total_tokens": 200, "context_window": 1000})

        events = await asyncio.to_thread(store.list_events, created["id"])
        self.assertTrue(any(event["type"] == "run.finished" for event in events))
        turns = {
            event["data"].get("turn")
            for event in events
            if isinstance(event["data"], dict) and "turn" in event["data"]
        }
        self.assertEqual(turns, {1, 2})
        self.assertEqual(
            sum(1 for event in events if event["type"] == "user.message"), 2
        )

        messages = await asyncio.to_thread(store.list_messages, created["id"])
        self.assertTrue(all(message.turn <= 2 for message in messages))
        self.assertEqual([message.content for message in messages], ["第一问", "第一答", "第二问", "第二答"])

        # 原会话没有被截断
        source_events = await asyncio.to_thread(store.list_events, source_id)
        self.assertTrue(
            any(
                event["type"] == "user.message" and event["data"].get("turn") == 3
                for event in source_events
            )
        )

    async def test_fork_rejects_unfinished_turn(self) -> None:
        project = await self._project()
        session = await self._session(project["code"])
        source_id = session["id"]
        await asyncio.to_thread(
            self._seed_turn, source_id, 1, text="第一问", content="第一答"
        )
        # 第二轮只有用户消息，没有 run.finished
        store.append_message(source_id, turn=2, role="user", content="第二问")
        store.append_event(
            source_id,
            "user.message",
            {"turn": 2, "text": "第二问", "content": "第二问", "assets": []},
        )
        store.update_session(source_id, turn=2)

        response = await self.client.post(
            f"/studio/api/agent/sessions/{source_id}/fork", json={"turn": 2}
        )
        body = await response.json()
        self.assertEqual(response.status, 400, body)
        self.assertIn("尚未完成", body["error"]["message"])

    async def test_fork_validates_turn(self) -> None:
        project = await self._project()
        session = await self._session(project["code"])
        response = await self.client.post(
            f"/studio/api/agent/sessions/{session['id']}/fork", json={"turn": 0}
        )
        body = await response.json()
        self.assertEqual(response.status, 400, body)

        response = await self.client.post(
            f"/studio/api/agent/sessions/{session['id']}/fork", json={"turn": True}
        )
        body = await response.json()
        self.assertEqual(response.status, 400, body)

    async def test_fork_unknown_session(self) -> None:
        response = await self.client.post(
            "/studio/api/agent/sessions/999999/fork", json={"turn": 1}
        )
        body = await response.json()
        self.assertEqual(response.status, 404, body)

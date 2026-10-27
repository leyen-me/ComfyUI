"""Agent HTTP 接口：会话 CRUD 与项目隔离。"""

from __future__ import annotations

import hashlib

from base import ApiTestCase
from filmline.agent.prompt import SYSTEM_PROMPT


class AgentSessionApiTest(ApiTestCase):
    async def test_system_prompt_is_exposed_verbatim(self) -> None:
        response = await self.client.get("/studio/api/agent/system-prompt")
        body = await response.json()
        self.assertEqual(response.status, 200, body)
        data = body["data"]
        self.assertEqual(data["prompt"], SYSTEM_PROMPT)
        self.assertEqual(data["chars"], len(SYSTEM_PROMPT))
        self.assertEqual(
            data["sha256"], hashlib.sha256(SYSTEM_PROMPT.encode("utf-8")).hexdigest()
        )
        self.assertGreaterEqual(data["tool_count"], 20)
        self.assertEqual(len(data["tools"]), data["tool_count"])
        self.assertIn("note", data)

    async def _project(self, name: str = "Agent 项目") -> dict:
        response = await self.client.post("/studio/api/projects", json={"name": name})
        body = await response.json()
        self.assertEqual(response.status, 201, body)
        return body["data"]

    async def test_session_lifecycle(self) -> None:
        project = await self._project()
        ref = project["code"]

        response = await self.client.get(f"/studio/api/projects/{ref}/agent/sessions")
        body = await response.json()
        self.assertEqual(body["data"]["items"], [])
        self.assertIn("model", body["data"])

        response = await self.client.post(
            f"/studio/api/projects/{ref}/agent/sessions", json={}
        )
        body = await response.json()
        self.assertEqual(response.status, 201, body)
        session = body["data"]
        self.assertEqual(session["status"], "idle")

        response = await self.client.get(f"/studio/api/projects/{ref}/agent/sessions")
        body = await response.json()
        self.assertEqual(len(body["data"]["items"]), 1)

        response = await self.client.patch(
            f"/studio/api/agent/sessions/{session['id']}", json={"title": "新标题"}
        )
        body = await response.json()
        self.assertEqual(body["data"]["title"], "新标题")

        response = await self.client.delete(f"/studio/api/agent/sessions/{session['id']}")
        self.assertEqual(response.status, 204)

        response = await self.client.get(f"/studio/api/projects/{ref}/agent/sessions")
        body = await response.json()
        self.assertEqual(body["data"]["items"], [])

    async def test_session_isolated_by_project(self) -> None:
        first = await self._project("甲")
        second = await self._project("乙")
        response = await self.client.post(
            f"/studio/api/projects/{first['code']}/agent/sessions", json={}
        )
        self.assertEqual(response.status, 201)

        response = await self.client.get(
            f"/studio/api/projects/{second['code']}/agent/sessions"
        )
        body = await response.json()
        self.assertEqual(body["data"]["items"], [])

    async def test_reject_message_without_project_asset(self) -> None:
        first = await self._project("甲")
        second = await self._project("乙")
        response = await self.client.post(
            f"/studio/api/projects/{first['code']}/agent/sessions", json={}
        )
        session = (await response.json())["data"]

        response = await self.client.post(
            f"/studio/api/agent/sessions/{session['id']}/messages",
            json={"text": "你好", "asset_ids": [9999]},
        )
        body = await response.json()
        self.assertEqual(response.status, 404)
        self.assertFalse(body["ok"])

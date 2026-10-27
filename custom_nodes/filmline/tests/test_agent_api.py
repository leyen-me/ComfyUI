"""Agent HTTP 接口：会话 CRUD 与项目隔离。"""

from __future__ import annotations

import hashlib
from unittest import mock

from base import ApiTestCase
from filmline.agent import skills
from filmline.agent.prompt import system_prompt


class AgentSessionApiTest(ApiTestCase):
    async def test_system_prompt_is_exposed_verbatim(self) -> None:
        response = await self.client.get("/studio/api/agent/system-prompt")
        body = await response.json()
        self.assertEqual(response.status, 200, body)
        data = body["data"]
        current = system_prompt()
        self.assertEqual(data["prompt"], current)
        self.assertEqual(data["chars"], len(current))
        self.assertEqual(
            data["sha256"], hashlib.sha256(current.encode("utf-8")).hexdigest()
        )
        self.assertEqual(data["skill_problems"], [])
        self.assertGreaterEqual(data["tool_count"], 20)
        self.assertEqual(len(data["tools"]), data["tool_count"])
        self.assertEqual(
            [item["id"] for item in data["skills"]], skills.ids()
        )
        self.assertIn("h3-prompt", [item["id"] for item in data["skills"]])
        self.assertGreater(data["skill_chars"], 1000)
        self.assertIn('<skill id="h3-prompt"', data["prompt"])
        self.assertNotIn(skills.get("h3-prompt").text, data["prompt"])
        self.assertIn("note", data)

    async def _project(self, name: str = "Agent 项目") -> dict:
        response = await self.client.post("/studio/api/projects", json={"name": name})
        body = await response.json()
        self.assertEqual(response.status, 201, body)
        return body["data"]

    async def test_balance_endpoint(self) -> None:
        payload = {
            "configured": True,
            "available": True,
            "items": [
                {"currency": "CNY", "total": "42.31", "granted": "2.31", "topped_up": "40.00"}
            ],
            "fetched_at": "2026-10-27T04:00:00Z",
        }
        with mock.patch(
            "filmline.api.agent.fetch_balance", mock.AsyncMock(return_value=payload)
        ):
            response = await self.client.get("/studio/api/agent/balance")
            body = await response.json()
        self.assertEqual(response.status, 200, body)
        self.assertEqual(body["data"]["items"][0]["total"], "42.31")

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

    async def test_session_thinking_settings(self) -> None:
        project = await self._project()
        response = await self.client.post(
            f"/studio/api/projects/{project['code']}/agent/sessions",
            json={"thinking": "enabled", "reasoning_effort": "low"},
        )
        session = (await response.json())["data"]
        self.assertEqual(session["thinking"], "enabled")
        self.assertEqual(session["reasoning_effort"], "low")

        response = await self.client.patch(
            f"/studio/api/agent/sessions/{session['id']}",
            json={"thinking": "enabled", "reasoning_effort": "max"},
        )
        body = await response.json()
        self.assertEqual(body["data"]["reasoning_effort"], "max")

        response = await self.client.patch(
            f"/studio/api/agent/sessions/{session['id']}",
            json={"reasoning_effort": "超高"},
        )
        self.assertEqual(response.status, 400)

        response = await self.client.patch(
            f"/studio/api/agent/sessions/{session['id']}",
            json={"thinking": "auto"},
        )
        body = await response.json()
        self.assertEqual(body["data"]["thinking"], "auto")

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

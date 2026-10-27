"""工作区事件总线与 SSE 接口测试。"""

from __future__ import annotations

import asyncio
import json

from base import ApiTestCase, AsyncDbTestCase

from filmline import db, events
from filmline.domain.assets import AssetService
from filmline.domain.episodes import EpisodeService
from filmline.domain.projects import ProjectService
from filmline.domain.schemas import (
    AssetUpdate,
    EpisodeCreate,
    ProjectCreate,
    TextAssetCreate,
)
from filmline.errors import InvalidArgument


class EventBusTest(AsyncDbTestCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.loop = asyncio.get_running_loop()
        events.BUS.bind(self.loop)
        self.queue = events.BUS.subscribe()

    async def asyncTearDown(self) -> None:
        events.BUS.unsubscribe(self.queue)
        events.BUS.unbind(self.loop)
        await super().asyncTearDown()

    async def _next(self) -> dict:
        return await asyncio.wait_for(self.queue.get(), timeout=2)

    async def test_publishes_after_commit(self) -> None:
        project = await asyncio.to_thread(ProjectService().create, ProjectCreate(name="事件测试"))
        event = await self._next()
        self.assertEqual(event["type"], events.PROJECTS)
        self.assertEqual(event["action"], "created")
        self.assertEqual(event["project_id"], project.id)

        asset = await asyncio.to_thread(
            AssetService().create_text,
            project.id,
            TextAssetCreate(name="设定", content="内容"),
        )
        event = await self._next()
        self.assertEqual(event["type"], events.ASSETS)
        self.assertEqual(event["action"], "created")
        self.assertEqual(event["project_id"], project.id)
        self.assertEqual(event["asset_ids"], [asset.id])

    async def test_rollback_does_not_publish(self) -> None:
        project = await asyncio.to_thread(ProjectService().create, ProjectCreate(name="回滚测试"))
        await self._next()  # 项目创建事件

        with self.assertRaises(InvalidArgument):
            with db.session_scope() as session:
                events.record(session, events.ASSETS, action="created", project_id=project.id)
                raise InvalidArgument("故意失败")

        with self.assertRaises(asyncio.TimeoutError):
            await asyncio.wait_for(self.queue.get(), timeout=0.2)

    async def test_episode_and_asset_events_carry_scope(self) -> None:
        project = await asyncio.to_thread(ProjectService().create, ProjectCreate(name="分集事件"))
        await self._next()

        episode = await asyncio.to_thread(
            EpisodeService().create, project.id, EpisodeCreate(title="第一集")
        )
        event = await self._next()
        self.assertEqual(event["type"], events.EPISODES)
        self.assertEqual(event["action"], "created")
        self.assertEqual(event["episode_id"], episode.id)

        asset = await asyncio.to_thread(
            AssetService().create_text,
            project.id,
            TextAssetCreate(name="分集资产", content="正文"),
            episode_id=episode.id,
        )
        event = await self._next()
        self.assertEqual(event["type"], events.ASSETS)
        self.assertEqual(event["episode_id"], episode.id)
        self.assertEqual(event["asset_ids"], [asset.id])

        await asyncio.to_thread(AssetService().update, asset.id, AssetUpdate(name="改名"))
        event = await self._next()
        self.assertEqual(event["action"], "updated")
        self.assertEqual(event["asset_ids"], [asset.id])

        await asyncio.to_thread(AssetService().delete, asset.id)
        event = await self._next()
        self.assertEqual(event["action"], "deleted")
        self.assertEqual(event["asset_ids"], [asset.id])

    async def test_no_loop_is_safe(self) -> None:
        events.BUS.unbind(self.loop)
        events.BUS.publish({"type": events.ASSETS, "action": "created"})
        # 重新绑定，避免影响后续用例
        events.BUS.bind(self.loop)


class WorkspaceEventsApiTest(ApiTestCase):
    async def _create_project(self, name: str = "事件项目") -> dict:
        response = await self.client.post("/studio/api/projects", json={"name": name})
        self.assertEqual(response.status, 201)
        return (await response.json())["data"]

    async def _read_event(self, response) -> dict:
        while True:
            line = await asyncio.wait_for(response.content.readline(), timeout=2)
            if not line:
                raise AssertionError("事件流意外结束")
            text = line.decode("utf-8").strip()
            if text.startswith("data:"):
                return json.loads(text[5:].strip())
            # 跳过 ping / retry 等控制帧

    async def test_stream_delivers_project_events_and_filters_others(self) -> None:
        project = await self._create_project()
        other = await self._create_project("另一个项目")

        response = await self.client.get(f"/studio/api/events?project={project['code']}")
        self.assertEqual(response.status, 200)
        self.assertTrue(response.headers["Content-Type"].startswith("text/event-stream"))
        try:
            # 先制造其他项目的事件，确保不会串台
            await self.client.post(
                f"/studio/api/projects/{other['code']}/assets",
                json={"name": "别处", "content": ""},
            )
            await self.client.post(
                f"/studio/api/projects/{project['code']}/assets",
                json={"name": "本项目", "content": ""},
            )
            event = await self._read_event(response)
            self.assertEqual(event["type"], "assets")
            self.assertEqual(event["action"], "created")
            self.assertEqual(event["project_id"], project["id"])
        finally:
            response.close()

    async def test_project_update_is_delivered(self) -> None:
        project = await self._create_project()
        response = await self.client.get(f"/studio/api/events?project={project['code']}")
        try:
            await self.client.patch(
                f"/studio/api/projects/{project['code']}", json={"name": "改名"}
            )
            event = await self._read_event(response)
            self.assertEqual(event["type"], "project")
            self.assertEqual(event["action"], "updated")
            self.assertEqual(event["project_id"], project["id"])
        finally:
            response.close()

    async def test_unknown_project_returns_error(self) -> None:
        response = await self.client.get("/studio/api/events?project=PRJ-9999")
        self.assertEqual(response.status, 404)
        body = await response.json()
        self.assertFalse(body["ok"])

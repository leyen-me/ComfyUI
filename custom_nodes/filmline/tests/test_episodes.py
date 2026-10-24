"""分集与分集级资产测试。"""

from __future__ import annotations

from aiohttp import FormData

from base import ApiTestCase

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
MP3_BYTES = b"ID3\x04\x00\x00" + b"\x00" * 16


class EpisodeApiTest(ApiTestCase):
    async def _project(self, name: str = "测试项目") -> dict:
        res = await self.client.post("/studio/api/projects", json={"name": name})
        return (await res.json())["data"]

    async def test_create_episodes_auto_numbered(self) -> None:
        project = await self._project()
        ref = project["code"]

        first = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"]
        second = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"]

        self.assertEqual(first["code"], "EP01")
        self.assertEqual(first["title"], "第 1 集")
        self.assertEqual(second["code"], "EP02")
        self.assertEqual(second["title"], "第 2 集")

    async def test_episode_numbering_not_reused_after_delete(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"]
        await self.client.delete(f"/studio/api/episodes/{first['id']}")

        again = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"]
        self.assertEqual(again["code"], "EP02")

    async def test_update_and_list(self) -> None:
        project = await self._project()
        ref = project["code"]
        episode = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={"title": "开篇"})).json())["data"]

        res = await self.client.patch(
            f"/studio/api/episodes/{episode['id']}", json={"title": "序章", "synopsis": "长安初雪"}
        )
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        self.assertEqual(body["data"]["title"], "序章")

        res = await self.client.get(f"/studio/api/projects/{ref}/episodes")
        items = (await res.json())["data"]["items"]
        self.assertEqual([item["code"] for item in items], ["EP01"])
        self.assertEqual(items[0]["synopsis"], "长安初雪")

    async def test_reorder_episodes(self) -> None:
        project = await self._project()
        ref = project["code"]
        eps = []
        for _ in range(3):
            eps.append((await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"])

        res = await self.client.put(
            f"/studio/api/projects/{ref}/episodes/order",
            json={"ids": [eps[2]["id"], eps[0]["id"], eps[1]["id"]]},
        )
        self.assertEqual(res.status, 204)

        items = (await (await self.client.get(f"/studio/api/projects/{ref}/episodes")).json())["data"]["items"]
        self.assertEqual([item["code"] for item in items], ["EP03", "EP01", "EP02"])

    async def test_assets_are_scoped(self) -> None:
        project = await self._project()
        ref = project["code"]
        episode = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"]

        # 项目级
        await self.client.post(
            f"/studio/api/projects/{ref}/assets", json={"name": "全片设定", "content": "x"}
        )
        # 分集级
        res = await self.client.post(
            f"/studio/api/projects/{ref}/assets?episode=EP01",
            json={"name": "第一场", "content": "y"},
        )
        self.assertEqual(res.status, 201)
        scoped = (await res.json())["data"]
        self.assertEqual(scoped["episode_id"], episode["id"])

        project_level = (await (await self.client.get(f"/studio/api/projects/{ref}/assets")).json())["data"]
        self.assertEqual(project_level["total"], 1)

        episode_level = (await (await self.client.get(f"/studio/api/projects/{ref}/assets?episode=EP01")).json())["data"]
        self.assertEqual(episode_level["total"], 1)
        self.assertEqual(episode_level["items"][0]["name"], "第一场")

        project_counts = (await (await self.client.get(f"/studio/api/projects/{ref}/assets/counts")).json())["data"]
        episode_counts = (await (await self.client.get(f"/studio/api/projects/{ref}/assets/counts?episode=EP01")).json())["data"]
        self.assertEqual(project_counts, {"text": 1, "image": 0, "video": 0, "audio": 0})
        self.assertEqual(episode_counts, {"text": 1, "image": 0, "video": 0, "audio": 0})

    async def test_upload_audio_into_episode(self) -> None:
        project = await self._project()
        ref = project["code"]
        await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})

        data = FormData()
        data.add_field("file", MP3_BYTES, filename="theme.mp3", content_type="audio/mpeg")
        res = await self.client.post(
            f"/studio/api/projects/{ref}/assets/upload?episode=EP01", data=data
        )
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        asset = body["data"]
        self.assertEqual(asset["kind"], "audio")
        self.assertEqual(asset["mime_type"], "audio/mpeg")
        self.assertIsNotNone(asset["episode_id"])

        res = await self.client.get(asset["content_url"])
        self.assertEqual(res.status, 200)
        self.assertEqual(await res.read(), MP3_BYTES)

    async def test_unknown_episode_returns_404(self) -> None:
        project = await self._project()
        res = await self.client.get(f"/studio/api/projects/{project['code']}/assets?episode=EP99")
        self.assertEqual(res.status, 404)

    async def test_deleted_episode_hides_but_keeps_assets(self) -> None:
        project = await self._project()
        ref = project["code"]
        episode = (await (await self.client.post(f"/studio/api/projects/{ref}/episodes", json={})).json())["data"]
        await self.client.post(
            f"/studio/api/projects/{ref}/assets?episode=EP01", json={"name": "留档", "content": "z"}
        )

        await self.client.delete(f"/studio/api/episodes/{episode['id']}")

        res = await self.client.get(f"/studio/api/projects/{ref}/episodes")
        self.assertEqual((await res.json())["data"]["total"], 0)
        # 资产未被删除，只是所在分集暂时不可见
        res = await self.client.get(f"/studio/api/projects/{ref}/assets?episode=EP01")
        self.assertEqual(res.status, 404)

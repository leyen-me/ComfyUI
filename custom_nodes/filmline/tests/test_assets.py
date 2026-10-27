"""资产接口测试：文本创建、上传、来源标记、内容读取、删除。"""

from __future__ import annotations

from urllib.parse import quote

from aiohttp import FormData

from base import ApiTestCase, AsyncDbTestCase, DbTestCase
from filmline.agent.tools.base import ToolContext
from filmline.domain.assets import AssetService
from filmline.domain.episodes import EpisodeService
from filmline.domain.projects import ProjectService
from filmline.domain.schemas import EpisodeCreate, ProjectCreate, TextAssetCreate
from filmline.errors import InvalidArgument, NotFound

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP4_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32


class AssetMoveTest(DbTestCase):
    """资产归属移动：项目级 <-> 分集，整批原子生效。"""

    def setUp(self) -> None:
        super().setUp()
        self.project = ProjectService().create(ProjectCreate(name="移动测试"))
        self.episode = EpisodeService().create(
            self.project.id, EpisodeCreate(title="第一集")
        )
        self.service = AssetService()

    def _asset(self, name: str):
        return self.service.create_text(
            self.project.id, TextAssetCreate(name=name, content="x")
        )

    def test_move_to_episode_and_back_to_project(self) -> None:
        asset = self._asset("尾帧")
        moved = self.service.move_many(
            self.project.id, [asset.id], episode_id=self.episode.id
        )
        self.assertEqual(moved[0].episode_id, self.episode.id)
        self.assertEqual(self.service.get(asset.id).episode_id, self.episode.id)

        back = self.service.move_many(self.project.id, [asset.id], episode_id=None)
        self.assertIsNone(back[0].episode_id)
        self.assertIsNone(self.service.get(asset.id).episode_id)

    def test_rejects_foreign_episode_without_partial_write(self) -> None:
        first, second = self._asset("a"), self._asset("b")
        other = ProjectService().create(ProjectCreate(name="别的项目"))
        foreign = EpisodeService().create(other.id, EpisodeCreate(title="别的集"))
        with self.assertRaises(InvalidArgument):
            self.service.move_many(
                self.project.id, [first.id, second.id], episode_id=foreign.id
            )
        self.assertIsNone(self.service.get(first.id).episode_id)
        self.assertIsNone(self.service.get(second.id).episode_id)

    def test_rejects_missing_asset_without_partial_write(self) -> None:
        asset = self._asset("a")
        with self.assertRaises(NotFound):
            self.service.move_many(self.project.id, [asset.id, 999_999], episode_id=None)
        self.assertIsNone(self.service.get(asset.id).episode_id)

    def test_rejects_duplicates_and_empty(self) -> None:
        asset = self._asset("a")
        with self.assertRaises(InvalidArgument):
            self.service.move_many(
                self.project.id, [asset.id, asset.id], episode_id=self.episode.id
            )
        with self.assertRaises(InvalidArgument):
            self.service.move_many(self.project.id, [], episode_id=None)


class AssetMoveToolTest(AsyncDbTestCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.project = ProjectService().create(ProjectCreate(name="移动工具"))
        self.episode = EpisodeService().create(
            self.project.id, EpisodeCreate(title="第一集")
        )
        self.service = AssetService()
        self.asset = self.service.create_text(
            self.project.id, TextAssetCreate(name="尾帧", content="x")
        )

    def _ctx(self) -> ToolContext:
        return ToolContext(
            session_id=1,
            project_id=self.project.id,
            project_code=self.project.code,
            project_name=self.project.name,
        )

    async def test_move_by_episode_code_and_back(self) -> None:
        from filmline.agent.tools.assets import _move_assets

        outcome = await _move_assets(
            self._ctx(), {"asset_ids": [self.asset.id], "episode": "ep01"}
        )
        self.assertTrue(outcome.ok)
        self.assertEqual(outcome.data["episode"], "EP01")
        self.assertEqual(self.service.get(self.asset.id).episode_id, self.episode.id)

        outcome = await _move_assets(self._ctx(), {"asset_ids": [self.asset.id]})
        self.assertTrue(outcome.ok)
        self.assertIsNone(outcome.data["episode"])
        self.assertIsNone(self.service.get(self.asset.id).episode_id)

    async def test_unknown_episode_is_rejected(self) -> None:
        from filmline.agent.tools.assets import _move_assets

        with self.assertRaises(NotFound):
            await _move_assets(
                self._ctx(), {"asset_ids": [self.asset.id], "episode": "EP99"}
            )
        self.assertIsNone(self.service.get(self.asset.id).episode_id)


class AssetApiTest(ApiTestCase):
    async def _project(self, name: str = "测试项目") -> dict:
        res = await self.client.post("/studio/api/projects", json={"name": name})
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def _upload(self, ref: str, filename: str, payload: bytes, *, source: str | None = None):
        data = FormData()
        data.add_field("file", payload, filename=filename, content_type="application/octet-stream")
        query = f"?source={source}" if source else ""
        return await self.client.post(
            f"/studio/api/projects/{ref}/assets/upload{query}", data=data
        )

    async def test_create_text_asset(self) -> None:
        project = await self._project()
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/assets",
            json={"name": "第一幕", "content": "夜，外景，长安城。"},
        )
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        asset = body["data"]
        self.assertEqual(asset["kind"], "text")
        self.assertEqual(asset["source"], "user")
        self.assertEqual(asset["text_content"], "夜，外景，长安城。")
        self.assertIsNone(asset["content_url"])

    async def test_list_filters_by_kind_and_counts(self) -> None:
        project = await self._project()
        ref = project["code"]
        await self.client.post(
            f"/studio/api/projects/{ref}/assets", json={"name": "文本", "content": "abc"}
        )
        await self._upload(ref, "a.png", PNG_BYTES)
        await self._upload(ref, "b.mp4", MP4_BYTES)

        res = await self.client.get(f"/studio/api/projects/{ref}/assets?kind=image")
        body = await res.json()
        self.assertEqual(body["data"]["total"], 1)
        self.assertEqual(body["data"]["items"][0]["kind"], "image")

        res = await self.client.get(f"/studio/api/projects/{ref}/assets/counts")
        counts = (await res.json())["data"]
        self.assertEqual(counts, {"text": 1, "image": 1, "video": 1, "audio": 0})

    async def test_project_list_exposes_cover_and_asset_count(self) -> None:
        project = await self._project()
        ref = project["code"]
        await self._upload(ref, "a.png", PNG_BYTES)
        latest = (await (await self._upload(ref, "b.png", PNG_BYTES)).json())["data"]
        await self._upload(ref, "c.mp4", MP4_BYTES)
        empty = await self._project("空项目")

        res = await self.client.get("/studio/api/projects")
        items = {item["code"]: item for item in (await res.json())["data"]["items"]}
        self.assertEqual(items[ref]["cover_asset_id"], latest["id"])
        self.assertEqual(items[ref]["asset_count"], 3)
        self.assertIsNone(items[empty["code"]]["cover_asset_id"])
        self.assertEqual(items[empty["code"]]["asset_count"], 0)

    async def test_list_filters_by_source(self) -> None:
        project = await self._project()
        ref = project["code"]
        await self._upload(ref, "user.png", PNG_BYTES)
        ai = (await (await self._upload(ref, "ai.mp4", MP4_BYTES, source="ai")).json())["data"]

        res = await self.client.get(f"/studio/api/projects/{ref}/assets?source=ai")
        items = (await res.json())["data"]["items"]
        self.assertEqual([item["id"] for item in items], [ai["id"]])

        res = await self.client.get(f"/studio/api/projects/{ref}/assets?source=bogus")
        self.assertEqual(res.status, 400)

    async def test_upload_marks_source(self) -> None:
        project = await self._project()
        ref = project["code"]

        res = await self._upload(ref, "user.png", PNG_BYTES)
        user_asset = (await res.json())["data"]
        self.assertEqual(user_asset["source"], "user")
        self.assertTrue(user_asset["content_url"].endswith(f"/assets/{user_asset['id']}/content"))

        res = await self._upload(ref, "ai.png", PNG_BYTES, source="ai")
        ai_asset = (await res.json())["data"]
        self.assertEqual(ai_asset["source"], "ai")

    async def test_upload_rejects_unsupported_type(self) -> None:
        project = await self._project()
        res = await self._upload(project["code"], "note.txt", b"hello")
        self.assertEqual(res.status, 400)

    async def test_upload_rejects_bad_source(self) -> None:
        project = await self._project()
        res = await self._upload(project["code"], "a.png", PNG_BYTES, source="robot")
        self.assertEqual(res.status, 400)

    async def test_content_endpoint_streams_file(self) -> None:
        project = await self._project()
        res = await self._upload(project["code"], "a.png", PNG_BYTES)
        asset = (await res.json())["data"]

        res = await self.client.get(asset["content_url"])
        self.assertEqual(res.status, 200)
        self.assertEqual(res.headers["Content-Type"], "image/png")
        self.assertEqual(await res.read(), PNG_BYTES)

    async def test_delete_asset(self) -> None:
        project = await self._project()
        res = await self._upload(project["code"], "a.png", PNG_BYTES)
        asset = (await res.json())["data"]

        res = await self.client.delete(f"/studio/api/assets/{asset['id']}")
        self.assertEqual(res.status, 204)

        res = await self.client.get(asset["content_url"])
        self.assertEqual(res.status, 404)

        res = await self.client.get(f"/studio/api/projects/{project['code']}/assets")
        self.assertEqual((await res.json())["data"]["total"], 0)

    async def test_unknown_project_returns_404(self) -> None:
        res = await self.client.get("/studio/api/projects/PRJ-9999/assets")
        self.assertEqual(res.status, 404)

    async def test_update_text_asset(self) -> None:
        project = await self._project()
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/assets",
            json={"name": "原名", "content": "旧内容"},
        )
        asset = (await res.json())["data"]

        res = await self.client.patch(
            f"/studio/api/assets/{asset['id']}",
            json={"name": "新名", "text_content": "新内容"},
        )
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        self.assertEqual(body["data"]["name"], "新名")
        self.assertEqual(body["data"]["text_content"], "新内容")

    async def test_rename_media_asset(self) -> None:
        project = await self._project()
        asset = (await (await self._upload(project["code"], "a.png", PNG_BYTES)).json())["data"]

        res = await self.client.patch(f"/studio/api/assets/{asset['id']}", json={"name": "剧照"})
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        self.assertEqual(body["data"]["name"], "剧照")

    async def test_cannot_edit_media_content(self) -> None:
        project = await self._project()
        asset = (await (await self._upload(project["code"], "a.png", PNG_BYTES)).json())["data"]

        res = await self.client.patch(
            f"/studio/api/assets/{asset['id']}", json={"text_content": "不该允许"}
        )
        self.assertEqual(res.status, 400)

    async def test_update_requires_changes(self) -> None:
        project = await self._project()
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/assets", json={"name": "甲"}
        )
        asset = (await res.json())["data"]
        res = await self.client.patch(f"/studio/api/assets/{asset['id']}", json={})
        self.assertEqual(res.status, 400)

    async def test_update_unknown_asset(self) -> None:
        res = await self.client.patch("/studio/api/assets/9999", json={"name": "甲"})
        self.assertEqual(res.status, 404)

    async def test_generation_meta_round_trips(self) -> None:
        """AI 资产的生成参数（提示词、尺寸、种子）必须原样返回，供复用。"""
        project = await self._project()
        meta = '{"prompt":"雪夜长安街","size":"16:9","width":1344,"height":768,"seed":42}'
        data = FormData()
        data.add_field("file", PNG_BYTES, filename="a.png", content_type="image/png")
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/assets/upload?source=ai&meta={quote(meta)}",
            data=data,
        )
        self.assertEqual(res.status, 201)
        asset = (await res.json())["data"]
        self.assertEqual(asset["source"], "ai")
        self.assertEqual(asset["meta"]["prompt"], "雪夜长安街")
        self.assertEqual(asset["meta"]["seed"], 42)

        listed = (await (await self.client.get(f"/studio/api/projects/{project['code']}/assets?kind=image")).json())["data"]
        self.assertEqual(listed["items"][0]["meta"]["prompt"], "雪夜长安街")

    async def test_get_single_asset(self) -> None:
        project = await self._project()
        asset = (await (await self._upload(project["code"], "a.png", PNG_BYTES)).json())["data"]
        res = await self.client.get(f"/studio/api/assets/{asset['id']}")
        body = await res.json()
        self.assertEqual(res.status, 200)
        self.assertEqual(body["data"]["name"], asset["name"])
        self.assertEqual(body["data"]["content_url"], asset["content_url"])

    def test_generation_stats_round_trip(self) -> None:
        """生成开始时间与耗时必须能存能取（用于统计与排查）。"""
        from datetime import datetime

        from filmline.domain.assets import AssetService
        from filmline.domain.projects import ProjectService
        from filmline.domain.schemas import AssetKind, AssetSource, ProjectCreate

        project = ProjectService().create(ProjectCreate(name="统计"))
        service = AssetService()
        asset = service.create_from_file(
            project.id,
            name="a.png",
            kind=AssetKind.image,
            source=AssetSource.ai,
            relative_path="9/project/a.png",
            mime_type="image/png",
            size_bytes=10,
            gen_started_at=datetime(2026, 10, 24, 17, 20, 31),
            gen_elapsed_ms=101_400,
        )
        self.assertEqual(asset.gen_elapsed_ms, 101400)
        self.assertEqual(asset.gen_started_at, "2026-10-24T17:20:31.000Z")

        fetched = service.get(asset.id)
        self.assertEqual(fetched.gen_elapsed_ms, 101400)

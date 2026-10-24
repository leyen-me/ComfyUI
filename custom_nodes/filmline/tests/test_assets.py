"""资产接口测试：文本创建、上传、来源标记、内容读取、删除。"""

from __future__ import annotations

from aiohttp import FormData

from base import ApiTestCase

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
MP4_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 32


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
        self.assertEqual(counts, {"text": 1, "image": 1, "video": 1})

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

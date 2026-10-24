"""生成接口：首尾帧载荷、数量校验与产物元数据（不连 ComfyUI）。"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

from aiohttp import FormData

from base import ApiTestCase
from filmline import generation

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class GenerateApiTest(ApiTestCase):
    async def _project(self) -> dict:
        res = await self.client.post("/studio/api/projects", json={"name": "生成测试"})
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def _image(self, ref: str, name: str) -> dict:
        data = FormData()
        data.add_field("file", PNG_BYTES, filename=name, content_type="image/png")
        res = await self.client.post(f"/studio/api/projects/{ref}/assets/upload", data=data)
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def test_keyframes_payload_and_meta(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "first.png")
        last = await self._image(ref, "last.png")

        fake = AsyncMock(
            return_value=(
                [generation.Product(filename="clip.mp4", suffix=".mp4", data=b"fake")],
                1.2,
            )
        )
        with patch("filmline.generation.run", new=fake):
            res = await self.client.post(
                f"/studio/api/projects/{ref}/generate",
                json={
                    "kind": "video",
                    "mode": "keyframes",
                    "prompt": "镜头推近，海面日落",
                    "size": "16:9",
                    "duration": 5,
                    "first_frame_id": first["id"],
                    "last_frame_id": last["id"],
                },
            )

        body = await res.json()
        self.assertEqual(res.status, 201, body)
        asset = body["data"]["items"][0]
        self.assertEqual(asset["kind"], "video")
        self.assertEqual(asset["meta"]["video_mode"], "keyframes")
        self.assertEqual(asset["meta"]["first_frame_id"], first["id"])
        self.assertEqual(asset["meta"]["last_frame_id"], last["id"])
        self.assertEqual(asset["meta"]["ref_ids"], [first["id"], last["id"]])

    async def test_legacy_refs_is_first_frame(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "first.png")

        fake = AsyncMock(
            return_value=(
                [generation.Product(filename="clip.mp4", suffix=".mp4", data=b"fake")],
                1.0,
            )
        )
        with patch("filmline.generation.run", new=fake):
            res = await self.client.post(
                f"/studio/api/projects/{ref}/generate",
                json={
                    "kind": "video",
                    "prompt": "x",
                    "size": "16:9",
                    "duration": 5,
                    "refs": [first["id"]],
                },
            )

        body = await res.json()
        self.assertEqual(res.status, 201, body)
        meta = body["data"]["items"][0]["meta"]
        self.assertEqual(meta["first_frame_id"], first["id"])
        self.assertIsNone(meta["last_frame_id"])

    async def test_rejects_unknown_video_mode(self) -> None:
        project = await self._project()
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/generate",
            json={"kind": "video", "mode": "reference", "prompt": "x", "duration": 5},
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)
        self.assertIn("keyframes", body["error"]["message"])

    async def test_rejects_mixed_refs_and_keyframes(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "first.png")
        res = await self.client.post(
            f"/studio/api/projects/{ref}/generate",
            json={
                "kind": "video",
                "prompt": "x",
                "duration": 5,
                "refs": [first["id"]],
                "first_frame_id": first["id"],
            },
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)

    async def test_rejects_same_image_for_both_frames(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "first.png")
        res = await self.client.post(
            f"/studio/api/projects/{ref}/generate",
            json={
                "kind": "video",
                "prompt": "x",
                "duration": 5,
                "first_frame_id": first["id"],
                "last_frame_id": first["id"],
            },
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)

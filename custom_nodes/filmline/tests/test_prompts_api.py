"""提示词优化接口：参数校验与 LLM 代理边界。"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, patch

from aiohttp import FormData

from base import ApiTestCase

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


class PromptOptimizeApiTest(ApiTestCase):
    async def _project(self) -> dict:
        res = await self.client.post("/studio/api/projects", json={"name": "AI 优化测试"})
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def _image(self, ref: str) -> dict:
        data = FormData()
        data.add_field("file", PNG_BYTES, filename="ref.png", content_type="image/png")
        res = await self.client.post(f"/studio/api/projects/{ref}/assets/upload", data=data)
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def test_missing_key_returns_503(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            res = await self.client.post(
                "/studio/api/prompts/optimize",
                json={
                    "mode": "video",
                    "video_mode": "keyframes",
                    "prompt": "小狗对老鹰说：你好",
                },
            )
        body = await res.json()
        self.assertEqual(res.status, 503, body)
        self.assertIn("DEEPSEEK_API_KEY", body["error"]["message"])

    async def test_optimize_success(self) -> None:
        fake = AsyncMock(
            return_value={
                "enhanced_prompt": "integrated_multimodal_description: ...",
                "warnings": ["需要检查说话人"],
                "notes": "",
                "model": "deepseek-chat",
            }
        )
        with patch("filmline.llm.optimize_prompt", new=fake):
            res = await self.client.post(
                "/studio/api/prompts/optimize",
                json={
                    "mode": "video",
                    "video_mode": "keyframes",
                    "prompt": "小狗对老鹰说：你好",
                    "keyframes": {"first": True, "last": False},
                    "references": [{"label": "<Picture 1>", "kind": "image"}],
                },
            )
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        self.assertEqual(body["data"]["enhanced_prompt"], "integrated_multimodal_description: ...")
        self.assertEqual(body["data"]["warnings"], ["需要检查说话人"])

    async def test_sends_images_to_llm(self) -> None:
        project = await self._project()
        asset = await self._image(project["code"])
        fake = AsyncMock(
            return_value={
                "enhanced_prompt": "optimized",
                "warnings": [],
                "notes": "",
                "model": "deepseek-chat",
            }
        )
        with patch("filmline.llm.optimize_prompt", new=fake):
            res = await self.client.post(
                "/studio/api/prompts/optimize",
                json={
                    "mode": "video",
                    "video_mode": "keyframes",
                    "prompt": "小狗对老鹰说：你好",
                    "project_ref": project["code"],
                    "keyframes": {"first": True, "last": False},
                    "references": [{"label": "<Picture 1>", "kind": "image"}],
                    "images": [
                        {
                            "asset_id": asset["id"],
                            "label": "<Picture 1>",
                            "role": "first_frame",
                        }
                    ],
                },
            )
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        _args, kwargs = fake.await_args
        images = kwargs.get("images") or []
        self.assertEqual(len(images), 1)
        self.assertEqual(images[0]["label"], "<Picture 1>")
        self.assertEqual(images[0]["role"], "first_frame")
        self.assertTrue(images[0]["data_url"].startswith("data:image/png;base64,"))

    async def test_images_require_project(self) -> None:
        res = await self.client.post(
            "/studio/api/prompts/optimize",
            json={
                "mode": "video",
                "video_mode": "keyframes",
                "prompt": "x",
                "images": [{"asset_id": 1, "label": "<Picture 1>", "role": "first_frame"}],
            },
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)

    async def test_rejects_image_mode(self) -> None:
        res = await self.client.post(
            "/studio/api/prompts/optimize",
            json={"mode": "image", "prompt": "x"},
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)

    async def test_rejects_empty_prompt(self) -> None:
        res = await self.client.post(
            "/studio/api/prompts/optimize",
            json={"mode": "video", "video_mode": "keyframes", "prompt": "   "},
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)

    async def test_long_draft_is_accepted(self) -> None:
        fake = AsyncMock(
            return_value={
                "enhanced_prompt": "compressed",
                "warnings": [],
                "notes": "",
                "model": "deepseek-flash",
            }
        )
        with patch("filmline.llm.optimize_prompt", new=fake):
            res = await self.client.post(
                "/studio/api/prompts/optimize",
                json={
                    "mode": "video",
                    "video_mode": "keyframes",
                    "prompt": "x" * 5000,
                },
            )
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        args, _kwargs = fake.await_args
        self.assertEqual(len(args[0]["prompt"]), 5000)


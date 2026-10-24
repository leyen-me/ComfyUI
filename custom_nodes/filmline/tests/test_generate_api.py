"""生成接口：首尾帧载荷、数量校验与产物元数据（不连 ComfyUI）。"""

from __future__ import annotations

import subprocess
from pathlib import Path
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

    async def _upload(self, ref: str, name: str, payload: bytes, content_type: str) -> dict:
        data = FormData()
        data.add_field("file", payload, filename=name, content_type=content_type)
        res = await self.client.post(f"/studio/api/projects/{ref}/assets/upload", data=data)
        body = await res.json()
        self.assertEqual(res.status, 201, body)
        return body["data"]

    async def _image(self, ref: str, name: str) -> dict:
        return await self._upload(ref, name, PNG_BYTES, "image/png")

    def _make_video(self, name: str, seconds: float = 2.0, audio: bool = True) -> Path:
        path = self.tmp / name
        command = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            f"color=c=blue:s=320x240:d={seconds}:r=24",
        ]
        if audio:
            command += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}"]
        command += ["-c:v", "libx264", "-pix_fmt", "yuv420p"]
        if audio:
            command += ["-c:a", "aac", "-shortest"]
        command.append(str(path))
        subprocess.run(command, check=True)
        return path

    def _make_audio(self, name: str = "ref.wav", seconds: float = 2.0) -> Path:
        path = self.tmp / name
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                f"sine=frequency=440:duration={seconds}",
                str(path),
            ],
            check=True,
        )
        return path

    async def _media(self, ref: str, path: Path, content_type: str) -> dict:
        return await self._upload(ref, path.name, path.read_bytes(), content_type)

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
            json={"kind": "video", "mode": "magic", "prompt": "x", "duration": 5},
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)
        self.assertIn("keyframes", body["error"]["message"])

    async def test_reference_requires_images(self) -> None:
        project = await self._project()
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/generate",
            json={"kind": "video", "mode": "reference", "prompt": "x", "duration": 5},
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)
        self.assertIn("至少需要 1 个素材", body["error"]["message"])

    async def test_reference_payload_and_meta(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "one.png")
        second = await self._image(ref, "two.png")

        fake = AsyncMock(
            return_value=(
                [generation.Product(filename="ref.mp4", suffix=".mp4", data=b"fake")],
                2.0,
            )
        )
        with patch("filmline.generation.run", new=fake):
            res = await self.client.post(
                f"/studio/api/projects/{ref}/generate",
                json={
                    "kind": "video",
                    "mode": "reference",
                    "prompt": "让 <Picture 1> 的人物站在 <Picture 2> 的场景里",
                    "size": "16:9",
                    "duration": 5,
                    "refs": [first["id"], second["id"]],
                },
            )

        body = await res.json()
        self.assertEqual(res.status, 201, body)
        meta = body["data"]["items"][0]["meta"]
        self.assertEqual(meta["video_mode"], "reference")
        self.assertEqual(meta["ref_ids"], [first["id"], second["id"]])
        self.assertNotIn("first_frame_id", meta)
        self.assertEqual(meta["ref_image_size"], "match")

    async def test_media_info_endpoint(self) -> None:
        project = await self._project()
        ref = project["code"]
        video = await self._media(ref, self._make_video("info.mp4", 2.0, True), "video/mp4")
        audio = await self._media(ref, self._make_audio("info.wav", 2.0), "audio/wav")

        res = await self.client.get(f"/studio/api/assets/{video['id']}/media-info")
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        info = body["data"]
        self.assertAlmostEqual(info["duration"], 2.0, delta=0.1)
        self.assertAlmostEqual(info["fps"], 24.0, delta=0.1)
        self.assertTrue(info["has_audio"])
        self.assertEqual(info["width"], 320)
        self.assertEqual(info["height"], 240)

        res = await self.client.get(f"/studio/api/assets/{audio['id']}/media-info")
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        self.assertAlmostEqual(body["data"]["duration"], 2.0, delta=0.1)
        self.assertTrue(body["data"]["has_audio"])

    async def test_reference_video_and_audio_payload(self) -> None:
        project = await self._project()
        ref = project["code"]
        video = await self._media(ref, self._make_video("ref.mp4", 2.0, True), "video/mp4")
        audio = await self._media(ref, self._make_audio(), "audio/wav")
        self.assertEqual(video["kind"], "video")
        self.assertAlmostEqual(video["meta"]["duration"], 2.0, delta=0.1)
        self.assertTrue(video["meta"]["has_audio"])

        fake = AsyncMock(
            return_value=(
                [generation.Product(filename="ref.mp4", suffix=".mp4", data=b"fake")],
                2.0,
            )
        )
        with patch("filmline.generation.run", new=fake):
            res = await self.client.post(
                f"/studio/api/projects/{ref}/generate",
                json={
                    "kind": "video",
                    "mode": "reference",
                    "prompt": "运镜参考 <Video 1>，音色参考 <Audio 2>",
                    "size": "16:9",
                    "duration": 5,
                    "ref_videos": [{"asset_id": video["id"], "use_audio": True}],
                    "ref_audios": [audio["id"]],
                },
            )

        body = await res.json()
        self.assertEqual(res.status, 201, body)
        meta = body["data"]["items"][0]["meta"]
        self.assertEqual(meta["video_mode"], "reference")
        self.assertEqual(meta["ref_video_ids"], [video["id"]])
        self.assertEqual(meta["ref_video_use_audio"], [True])
        self.assertEqual(meta["ref_audio_ids"], [audio["id"]])
        self.assertNotIn("first_frame_id", meta)

    async def test_reference_rejects_short_video(self) -> None:
        project = await self._project()
        ref = project["code"]
        video = await self._media(ref, self._make_video("short.mp4", 1.0, False), "video/mp4")
        res = await self.client.post(
            f"/studio/api/projects/{ref}/generate",
            json={
                "kind": "video",
                "mode": "reference",
                "prompt": "x",
                "duration": 5,
                "ref_videos": [{"asset_id": video["id"], "use_audio": False}],
            },
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)
        self.assertIn("2–15 秒", body["error"]["message"])

    async def test_reference_rejects_missing_soundtrack(self) -> None:
        project = await self._project()
        ref = project["code"]
        video = await self._media(ref, self._make_video("silent.mp4", 2.0, False), "video/mp4")
        res = await self.client.post(
            f"/studio/api/projects/{ref}/generate",
            json={
                "kind": "video",
                "mode": "reference",
                "prompt": "x",
                "duration": 5,
                "ref_videos": [{"asset_id": video["id"], "use_audio": True}],
            },
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)
        self.assertIn("没有音轨", body["error"]["message"])

    async def test_reference_rejects_keyframe_fields(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "one.png")
        res = await self.client.post(
            f"/studio/api/projects/{ref}/generate",
            json={
                "kind": "video",
                "mode": "reference",
                "prompt": "x",
                "duration": 5,
                "refs": [first["id"]],
                "first_frame_id": first["id"],
            },
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)

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

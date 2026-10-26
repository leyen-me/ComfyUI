"""生成接口：首尾帧载荷、数量校验与产物元数据（不连 ComfyUI）。"""

from __future__ import annotations

import asyncio
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

    async def _wait_task(self, task_id: int, timeout: float = 5.0) -> dict:
        deadline = asyncio.get_event_loop().time() + timeout
        while asyncio.get_event_loop().time() < deadline:
            res = await self.client.get(f"/studio/api/tasks/{task_id}")
            body = await res.json()
            self.assertEqual(res.status, 200, body)
            task = body["data"]
            if task["status"] in ("succeeded", "failed", "cancelled"):
                return task
            await asyncio.sleep(0.05)
        self.fail("后台生成任务未在超时时间内结束")

    @staticmethod
    def _fake_run(kind: str = "video", elapsed: float = 1.0):
        suffix = ".png" if kind == "image" else ".mp4"
        return AsyncMock(
            return_value=(
                [generation.Product(filename=f"clip{suffix}", suffix=suffix, data=b"fake")],
                elapsed,
            )
        )

    async def test_keyframes_payload_and_meta(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "first.png")
        last = await self._image(ref, "last.png")

        with patch(
            "filmline.generation.submit", new=AsyncMock(return_value="prompt-kf")
        ), patch("filmline.generation.collect", new=self._fake_run("video", 1.2)):
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
                    "client_label": "测试员",
                },
            )
            body = await res.json()
            self.assertEqual(res.status, 202, body)
            task = await self._wait_task(body["data"]["task"]["id"])

        self.assertEqual(task["status"], "succeeded")
        self.assertEqual(task["client_label"], "测试员")
        self.assertEqual(len(task["asset_ids"]), 1)
        asset = (
            await (
                await self.client.get(f"/studio/api/assets/{task['asset_ids'][0]}")
            ).json()
        )["data"]
        self.assertEqual(asset["kind"], "video")
        self.assertEqual(asset["meta"]["video_mode"], "keyframes")
        self.assertEqual(asset["meta"]["first_frame_id"], first["id"])
        self.assertEqual(asset["meta"]["last_frame_id"], last["id"])
        self.assertEqual(asset["meta"]["ref_ids"], [first["id"], last["id"]])

    async def test_legacy_refs_is_first_frame(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "first.png")

        with patch(
            "filmline.generation.submit", new=AsyncMock(return_value="prompt-legacy")
        ), patch("filmline.generation.collect", new=self._fake_run("video", 1.0)):
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
            self.assertEqual(res.status, 202, body)
            task = await self._wait_task(body["data"]["task"]["id"])

        self.assertEqual(task["status"], "succeeded")
        asset = (
            await (
                await self.client.get(f"/studio/api/assets/{task['asset_ids'][0]}")
            ).json()
        )["data"]
        meta = asset["meta"]
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

    async def test_rejects_duration_out_of_range(self) -> None:
        project = await self._project()
        for duration in (4, 16):
            res = await self.client.post(
                f"/studio/api/projects/{project['code']}/generate",
                json={
                    "kind": "video",
                    "mode": "keyframes",
                    "prompt": "x",
                    "duration": duration,
                },
            )
            body = await res.json()
            self.assertEqual(res.status, 400, body)
            self.assertIn("5–15", body["error"]["message"])

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

        with patch(
            "filmline.generation.submit", new=AsyncMock(return_value="prompt-ref-img")
        ), patch("filmline.generation.collect", new=self._fake_run("video", 2.0)):
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
            self.assertEqual(res.status, 202, body)
            task = await self._wait_task(body["data"]["task"]["id"])

        self.assertEqual(task["status"], "succeeded")
        asset = (
            await (
                await self.client.get(f"/studio/api/assets/{task['asset_ids'][0]}")
            ).json()
        )["data"]
        meta = asset["meta"]
        self.assertEqual(meta["video_mode"], "reference")
        self.assertEqual(meta["ref_ids"], [first["id"], second["id"]])
        self.assertNotIn("first_frame_id", meta)
        self.assertEqual(meta["ref_image_size"], "match")

    async def test_removed_hybrid_mode_is_rejected(self) -> None:
        project = await self._project()
        res = await self.client.post(
            f"/studio/api/projects/{project['code']}/generate",
            json={"kind": "video", "mode": "hybrid", "prompt": "x", "duration": 5},
        )
        body = await res.json()
        self.assertEqual(res.status, 400, body)
        self.assertIn("keyframes / reference", body["error"]["message"])

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

        with patch(
            "filmline.generation.submit", new=AsyncMock(return_value="prompt-ref-av")
        ), patch("filmline.generation.collect", new=self._fake_run("video", 2.0)):
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
            self.assertEqual(res.status, 202, body)
            task = await self._wait_task(body["data"]["task"]["id"])

        self.assertEqual(task["status"], "succeeded")
        asset = (
            await (
                await self.client.get(f"/studio/api/assets/{task['asset_ids'][0]}")
            ).json()
        )["data"]
        meta = asset["meta"]
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

    async def test_task_list_merges_external_queue(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "one.png")

        with patch(
            "filmline.generation.submit", new=AsyncMock(return_value="prompt-list")
        ), patch("filmline.generation.collect", new=self._fake_run("video", 1.0)):
            res = await self.client.post(
                f"/studio/api/projects/{ref}/generate",
                json={
                    "kind": "video",
                    "prompt": "x",
                    "size": "16:9",
                    "duration": 5,
                    "first_frame_id": first["id"],
                },
            )
            body = await res.json()
            self.assertEqual(res.status, 202, body)
            task = await self._wait_task(body["data"]["task"]["id"])

        external = generation.QueuedPrompt(
            prompt_id="external-1",
            graph={
                "1": {"class_type": "SaveVideo", "inputs": {}},
                "2": {"class_type": "CLIPTextEncode", "inputs": {"prompt": "外部任务"}},
            },
            extra_data={"client_id": "someone-else"},
        )
        with patch(
            "filmline.generation.queue_snapshot",
            new=AsyncMock(return_value=([external], [])),
        ):
            res = await self.client.get("/studio/api/tasks?limit=20")
        body = await res.json()
        self.assertEqual(res.status, 200, body)
        items = body["data"]["items"]
        ours = next(item for item in items if item["id"] == task["id"])
        self.assertEqual(ours["status"], "succeeded")
        self.assertFalse(ours["external"])
        foreign = next(item for item in items if item["prompt_id"] == "external-1")
        self.assertTrue(foreign["external"])
        self.assertEqual(foreign["kind"], "video")
        self.assertEqual(foreign["project_name"], "ComfyUI 外部任务")
        self.assertGreaterEqual(body["data"]["active"], 1)

    async def test_cancel_active_task(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "one.png")
        gate = asyncio.Event()

        async def slow_collect(*args, **kwargs):
            await gate.wait()
            return (
                [generation.Product(filename="clip.mp4", suffix=".mp4", data=b"fake")],
                1.0,
            )

        try:
            with patch(
                "filmline.generation.submit", new=AsyncMock(return_value="prompt-cancel")
            ), patch("filmline.generation.collect", new=slow_collect), patch(
                "filmline.generation.cancel", new=AsyncMock(return_value=True)
            ):
                res = await self.client.post(
                    f"/studio/api/projects/{ref}/generate",
                    json={
                        "kind": "video",
                        "prompt": "x",
                        "size": "16:9",
                        "duration": 5,
                        "first_frame_id": first["id"],
                    },
                )
                body = await res.json()
                self.assertEqual(res.status, 202, body)
                task_id = body["data"]["task"]["id"]

                deadline = asyncio.get_event_loop().time() + 3
                while asyncio.get_event_loop().time() < deadline:
                    res = await self.client.get(f"/studio/api/tasks/{task_id}")
                    current = (await res.json())["data"]
                    if current["status"] == "running":
                        break
                    await asyncio.sleep(0.02)
                self.assertEqual(current["status"], "running")

                res = await self.client.post(f"/studio/api/tasks/{task_id}/cancel")
                cancelled = (await res.json())["data"]
                self.assertEqual(res.status, 200)
                self.assertEqual(cancelled["status"], "cancelled")
                self.assertEqual(cancelled["error"], None)
        finally:
            gate.set()
            await asyncio.sleep(0.05)

    async def test_resubmits_lost_task(self) -> None:
        project = await self._project()
        ref = project["code"]
        first = await self._image(ref, "one.png")
        submit = AsyncMock(side_effect=["old-prompt", "new-prompt"])
        collect = AsyncMock(
            side_effect=[
                generation.GenerationFailed("ComfyUI 任务已丢失或服务已重启"),
                (
                    [generation.Product(filename="clip.mp4", suffix=".mp4", data=b"fake")],
                    1.0,
                ),
            ]
        )
        with patch("filmline.generation.submit", new=submit), patch(
            "filmline.generation.collect", new=collect
        ):
            res = await self.client.post(
                f"/studio/api/projects/{ref}/generate",
                json={
                    "kind": "video",
                    "prompt": "x",
                    "size": "16:9",
                    "duration": 5,
                    "first_frame_id": first["id"],
                },
            )
            body = await res.json()
            self.assertEqual(res.status, 202, body)
            task = await self._wait_task(body["data"]["task"]["id"])

        self.assertEqual(task["status"], "succeeded")
        self.assertEqual(task["prompt_id"], "new-prompt")
        self.assertEqual(len(task["asset_ids"]), 1)
        self.assertEqual(submit.await_count, 2)

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

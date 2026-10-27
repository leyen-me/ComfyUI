"""Files API：URL、data URL 解码、缓存命中、上传与内联回退。"""

from __future__ import annotations

import base64
import unittest
from datetime import datetime, timedelta
from unittest import mock

import base  # noqa: F401
from filmline.agent import files, store
from filmline.config import AgentSettings

DATA_URL = "data:image/png;base64," + base64.b64encode(b"fake-image").decode()


def _settings(**overrides) -> AgentSettings:
    values = dict(
        api_key="test-key",
        base_url="https://api.deepseek.com",
        model="deepseek-flash",
        thinking="auto",
        reasoning_effort="high",
        context_window=1_000_000,
        max_tokens=8192,
        timeout=300,
        tick_seconds=300,
        image_mode="auto",
        file_expiry_seconds=2_592_000,
    )
    values.update(overrides)
    return AgentSettings(**values)


class FileHelpersTest(unittest.TestCase):
    def test_files_url_handles_v1_and_root(self) -> None:
        self.assertEqual(
            files.files_url("https://api.deepseek.com"), "https://api.deepseek.com/files"
        )
        self.assertEqual(
            files.files_url("https://api.deepseek.com/v1/"),
            "https://api.deepseek.com/files",
        )

    def test_decode_data_url(self) -> None:
        mime, raw = files.decode_data_url(DATA_URL)
        self.assertEqual(mime, "image/png")
        self.assertEqual(raw, b"fake-image")
        with self.assertRaises(files.FileError):
            files.decode_data_url("not-a-data-url")


class EnsureFileTest(unittest.IsolatedAsyncioTestCase):
    async def test_inline_mode_skips_upload(self) -> None:
        with mock.patch.object(files, "_upload", mock.AsyncMock()) as upload:
            result = await files.ensure_file(DATA_URL, "a.png", settings=_settings(image_mode="inline"))
        self.assertIsNone(result)
        upload.assert_not_awaited()

    async def test_cache_hit_reuses_file_id(self) -> None:
        future = datetime.utcnow() + timedelta(days=1)
        with (
            mock.patch.object(store, "get_agent_file", return_value=("file-api-cached", future)),
            mock.patch.object(store, "touch_agent_file"),
            mock.patch.object(files, "_upload", mock.AsyncMock()) as upload,
        ):
            result = await files.ensure_file(DATA_URL, "a.png", settings=_settings())
        self.assertEqual(result.file_id, "file-api-cached")
        upload.assert_not_awaited()

    async def test_upload_and_persist(self) -> None:
        with (
            mock.patch.object(store, "get_agent_file", return_value=None),
            mock.patch.object(store, "save_agent_file") as save,
            mock.patch.object(
                files, "_upload", mock.AsyncMock(return_value={"id": "file-api-new"})
            ),
        ):
            result = await files.ensure_file(DATA_URL, "a.png", settings=_settings())
        self.assertEqual(result.file_id, "file-api-new")
        self.assertIsNotNone(result.expires_at)
        save.assert_called_once()

    async def test_upload_failure_falls_back_inline(self) -> None:
        with (
            mock.patch.object(store, "get_agent_file", return_value=None),
            mock.patch.object(
                files,
                "_upload",
                mock.AsyncMock(side_effect=files.FileError("down", code="network")),
            ),
        ):
            result = await files.ensure_file(DATA_URL, "a.png", settings=_settings())
        self.assertIsNone(result)

"""图片编码：小图原样发送，超大图必须重编码到安全尺寸。"""

from __future__ import annotations

import base64
import io
import tempfile
import unittest
from pathlib import Path

import base  # noqa: F401
from PIL import Image

from filmline import media


class ImageEncodingTest(unittest.TestCase):
    def test_small_supported_image_passes_through(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "small.png"
            Image.new("RGB", (320, 180), (20, 30, 40)).save(path)
            url = media.image_data_url(path)
        self.assertTrue(url.startswith("data:image/png;base64,"))

    def test_large_edge_is_reencoded(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "huge.png"
            # 单边 5000 > 官方 4096 上限；白色 PNG 压缩后远小于 6MB
            Image.new("RGB", (5000, 1000), (255, 255, 255)).save(path)
            self.assertLess(path.stat().st_size, media.MAX_INLINE_IMAGE_BYTES)
            url = media.image_data_url(path)
        self.assertTrue(url.startswith("data:image/jpeg;base64,"))
        raw = base64.b64decode(url.split(",", 1)[1])
        with Image.open(io.BytesIO(raw)) as image:
            self.assertLessEqual(max(image.size), media.MAX_INLINE_IMAGE_PIXELS)

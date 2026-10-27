"""测试基座：使用独立临时库，不触碰真实数据。

运行方式（在 ComfyUI 根目录）::

    ./venv/bin/python -m unittest discover -s custom_nodes/filmline/tests -t custom_nodes/filmline/tests
"""

from __future__ import annotations

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

_EXT_ROOT = Path(__file__).resolve().parents[1]
_SRC = _EXT_ROOT / "src"
if str(_SRC) not in sys.path:
    sys.path.insert(0, str(_SRC))

from filmline import config, db  # noqa: E402


def _isolate_data_dir(tmp: Path) -> None:
    """把资产目录也指到临时目录，避免测试往真实 user 目录写文件。"""
    import os

    os.environ[config.ENV_DATA_DIR] = str(tmp / "data")
    config.reset_cache()


def _restore_data_dir() -> None:
    import os

    os.environ.pop(config.ENV_DATA_DIR, None)
    config.reset_cache()


class DbTestCase(unittest.TestCase):
    """只有数据库的测试。"""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="filmline_test_"))
        _isolate_data_dir(self.tmp)
        db.reset()
        db.init(self.tmp / "test.db")

    def tearDown(self) -> None:
        db.reset()
        _restore_data_dir()
        shutil.rmtree(self.tmp, ignore_errors=True)


class AsyncDbTestCase(unittest.IsolatedAsyncioTestCase):
    """异步测试 + 独立临时库。"""

    async def asyncSetUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="filmline_async_"))
        _isolate_data_dir(self.tmp)
        db.reset()
        db.init(self.tmp / "test.db")

    async def asyncTearDown(self) -> None:
        db.reset()
        _restore_data_dir()
        shutil.rmtree(self.tmp, ignore_errors=True)


class ApiTestCase(unittest.IsolatedAsyncioTestCase):
    """带 aiohttp 进程内服务的测试。"""

    async def asyncSetUp(self) -> None:
        from aiohttp import web

        from filmline.api.routes import register_routes

        self.tmp = Path(tempfile.mkdtemp(prefix="filmline_api_"))
        _isolate_data_dir(self.tmp)
        db.reset()
        db.init(self.tmp / "test.db")

        app = web.Application()
        register_routes(app)

        from aiohttp.test_utils import TestClient, TestServer

        self.client = TestClient(TestServer(app))
        await self.client.start_server()

    async def asyncTearDown(self) -> None:
        await self.client.close()
        db.reset()
        _restore_data_dir()
        shutil.rmtree(self.tmp, ignore_errors=True)

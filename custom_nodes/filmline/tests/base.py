"""测试基座：使用独立临时库，不触碰真实数据。

运行方式（在 ComfyUI 根目录）::

    ./venv/bin/python -m unittest discover -s custom_nodes/filmline/tests -t custom_nodes/filmline
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

from filmline import db  # noqa: E402


class DbTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = Path(tempfile.mkdtemp(prefix="filmline_test_"))
        db.reset()
        db.init(self._tmp / "test.db")

    def tearDown(self) -> None:
        db.reset()
        shutil.rmtree(self._tmp, ignore_errors=True)

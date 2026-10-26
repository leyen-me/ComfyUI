"""实时进度快照测试（不连 ComfyUI）。"""

from __future__ import annotations

import unittest

from base import DbTestCase  # noqa: F401  (确保 src 进入 sys.path)
from filmline import progress


class ProgressSnapshotTest(unittest.TestCase):
    def tearDown(self) -> None:
        progress.clear(1)

    def test_percent_and_stage(self) -> None:
        progress._progress[1] = progress.ProgressState(
            value=13, max=20, node="9", stage="采样", updated_at=123.0
        )
        self.assertEqual(
            progress.snapshot(1),
            {
                "value": 13,
                "max": 20,
                "percent": 65,
                "node": "9",
                "stage": "采样",
                "updated_at": 123.0,
            },
        )

    def test_unknown_and_zero_max(self) -> None:
        self.assertIsNone(progress.snapshot(1))
        progress._progress[1] = progress.ProgressState(value=0, max=0)
        snapshot = progress.snapshot(1)
        self.assertIsNotNone(snapshot)
        self.assertIsNone(snapshot["percent"])


if __name__ == "__main__":
    unittest.main()

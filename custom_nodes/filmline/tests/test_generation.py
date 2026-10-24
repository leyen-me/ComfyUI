"""生成工作流构造测试（不联网、不跑模型）。"""

from __future__ import annotations

import unittest

from base import DbTestCase  # noqa: F401  (确保 src 进入 sys.path)
from filmline import generation
from filmline.errors import InvalidArgument


class ImageWorkflowTest(unittest.TestCase):
    def test_default_shape(self) -> None:
        wf = generation.image_workflow(prompt="长安城夜景", size="16:9", count=2, seed=42)
        graph = wf.prompt

        self.assertEqual(wf.kind, "image")
        self.assertEqual(graph["6"]["class_type"], "FilmlineEmptyLatent")
        self.assertEqual(graph["6"]["inputs"]["width"], 1344)
        self.assertEqual(graph["6"]["inputs"]["height"], 768)
        self.assertEqual(graph["6"]["inputs"]["batch_size"], 2)

        sampler = graph["7"]["inputs"]
        self.assertEqual(sampler["seed"], 42)
        self.assertEqual(sampler["positive"], ["5", 0])
        self.assertEqual(sampler["negative"], ["5", 1])
        self.assertEqual(sampler["latent_image"], ["6", 0])
        self.assertEqual(sampler["model"], ["4", 0])

        self.assertEqual(graph["9"]["class_type"], "SaveImage")
        self.assertEqual(wf.meta["size"], "16:9")

    def test_portrait_and_square(self) -> None:
        portrait = generation.image_workflow(prompt="x", size="9:16", count=1)
        square = generation.image_workflow(prompt="x", size="1:1", count=1)
        self.assertEqual(
            (portrait.prompt["6"]["inputs"]["width"], portrait.prompt["6"]["inputs"]["height"]),
            (768, 1344),
        )
        self.assertEqual(
            (square.prompt["6"]["inputs"]["width"], square.prompt["6"]["inputs"]["height"]),
            (1024, 1024),
        )

    def test_rejects_bad_input(self) -> None:
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(prompt="x", size="21:9", count=1)
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(prompt="x", size="1:1", count=0)
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(prompt="x", size="1:1", count=5)
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(prompt="   ", size="1:1", count=1)


class VideoWorkflowTest(unittest.TestCase):
    def test_default_shape(self) -> None:
        wf = generation.video_workflow(prompt="海面日落", size="16:9", duration=5, seed=7)
        graph = wf.prompt

        self.assertEqual(wf.kind, "video")
        self.assertEqual(graph["7"]["class_type"], "MiniMaxH3ImageToVideo")
        self.assertEqual(graph["7"]["inputs"]["length"], 124)
        self.assertEqual(graph["2"]["class_type"], "LoraLoaderModelOnly")
        self.assertEqual(graph["9"]["inputs"]["steps"], 4)
        self.assertEqual(graph["9"]["inputs"]["cfg"], 1.0)
        self.assertEqual(graph["9"]["inputs"]["negative"], ["8", 0])
        self.assertEqual(graph["13"]["class_type"], "SaveVideo")

    def test_ten_seconds(self) -> None:
        wf = generation.video_workflow(prompt="x", size="9:16", duration=10)
        self.assertEqual(wf.prompt["7"]["inputs"]["length"], 243)
        self.assertEqual(wf.prompt["7"]["inputs"]["height"], 1344)

    def test_rejects_bad_input(self) -> None:
        with self.assertRaises(InvalidArgument):
            generation.video_workflow(prompt="x", size="1:1", duration=5)
        with self.assertRaises(InvalidArgument):
            generation.video_workflow(prompt="x", size="16:9", duration=7)


if __name__ == "__main__":
    unittest.main()

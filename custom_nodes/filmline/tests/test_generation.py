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
        self.assertEqual(graph["6"]["inputs"]["width"], 1376)
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
        # 纯文生图不接 vae，resolution 用较长边
        self.assertNotIn("vae", graph["5"]["inputs"])
        self.assertEqual(graph["5"]["inputs"]["resolution"], 1376)

    def test_portrait_and_square(self) -> None:
        portrait = generation.image_workflow(prompt="x", size="9:16", count=1)
        square = generation.image_workflow(prompt="x", size="1:1", count=1)
        self.assertEqual(
            (portrait.prompt["6"]["inputs"]["width"], portrait.prompt["6"]["inputs"]["height"]),
            (768, 1376),
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


class ReferenceWorkflowTest(unittest.TestCase):
    def test_image_refs_feed_encoder_and_use_its_latent(self) -> None:
        wf = generation.image_workflow(
            prompt="把图1的人放到图2的场景",
            size="16:9",
            count=1,
            refs=["4/project/a.png", "4/project/b.png"],
            seed=3,
        )
        graph = wf.prompt

        self.assertEqual(graph["11"]["inputs"]["path"], "4/project/a.png")
        self.assertEqual(graph["12"]["inputs"]["path"], "4/project/b.png")
        # 参考图先按目标比例居中裁切，保证输出尺寸由用户决定
        self.assertEqual(graph["31"]["class_type"], "ImageScale")
        self.assertEqual(graph["31"]["inputs"]["crop"], "center")
        self.assertEqual(graph["31"]["inputs"]["width"], 1376)
        self.assertEqual(graph["31"]["inputs"]["height"], 768)
        self.assertEqual(graph["5"]["inputs"]["images.image_1"], ["31", 0])
        self.assertEqual(graph["5"]["inputs"]["images.image_2"], ["32", 0])
        # 参考图要接 vae（否则不参与采样），且 resolution=0 保持原图尺寸
        self.assertEqual(graph["5"]["inputs"]["vae"], ["3", 0])
        self.assertEqual(graph["5"]["inputs"]["resolution"], 0)
        # 参考图模式下 latent 来自编码节点，且不再使用空 latent 节点
        self.assertEqual(graph["7"]["inputs"]["latent_image"], ["5", 2])
        self.assertNotIn("6", graph)
        self.assertEqual(wf.meta["refs"], 2)

    def test_image_refs_limit_and_count(self) -> None:
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(
                prompt="x",
                size="1:1",
                count=1,
                refs=[f"a{i}.png" for i in range(generation.MAX_IMAGE_REFS + 1)],
            )

    def test_max_refs_allowed(self) -> None:
        refs = [f"a{i}.png" for i in range(generation.MAX_IMAGE_REFS)]
        wf = generation.image_workflow(prompt="满额参考图", size="1:1", count=1, refs=refs)
        keys = [k for k in wf.prompt["5"]["inputs"] if k.startswith("images.")]
        self.assertEqual(len(keys), generation.MAX_IMAGE_REFS)
        self.assertEqual(generation.MAX_IMAGE_REFS, 10)
        self.assertEqual(wf.meta["refs"], 10)
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(prompt="x", size="1:1", count=2, refs=["a.png"])

    def test_video_first_frame(self) -> None:
        wf = generation.video_workflow(
            prompt="镜头推进", size="16:9", duration=5, refs=["4/project/a.png"]
        )
        self.assertEqual(wf.prompt["14"]["class_type"], "FilmlineLoadImage")
        self.assertEqual(wf.prompt["15"]["class_type"], "ImageScale")
        self.assertEqual(wf.prompt["15"]["inputs"]["crop"], "center")
        self.assertEqual(wf.prompt["7"]["inputs"]["first_frame"], ["15", 0])
        self.assertEqual(wf.meta["refs"], 1)

    def test_video_single_ref_only(self) -> None:
        with self.assertRaises(InvalidArgument):
            generation.video_workflow(
                prompt="x", size="16:9", duration=5, refs=["a.png", "b.png"]
            )


class DimensionsTest(unittest.TestCase):
    def test_tiers(self) -> None:
        # 2K 行与官方原生表一致
        self.assertEqual(generation.image_dimensions("16:9", "2k"), (2752, 1536))
        self.assertEqual(generation.image_dimensions("9:16", "2k"), (1536, 2752))
        self.assertEqual(generation.image_dimensions("1:1", "2k"), (2048, 2048))
        # 1K / 4K 是它的等比缩放
        self.assertEqual(generation.image_dimensions("16:9", "1k"), (1376, 768))
        self.assertEqual(generation.image_dimensions("1:1", "1k"), (1024, 1024))

    def test_tier_feeds_workflow(self) -> None:
        wf = generation.image_workflow(prompt="x", size="16:9", count=1, tier="2k", seed=1)
        self.assertEqual(wf.prompt["6"]["inputs"]["width"], 2752)
        self.assertEqual(wf.prompt["6"]["inputs"]["height"], 1536)
        self.assertEqual(wf.meta["tier"], "2k")

    def test_rejects_bad_tier(self) -> None:
        with self.assertRaises(InvalidArgument):
            generation.image_workflow(prompt="x", size="16:9", count=1, tier="8k")


class RatioLabelTest(unittest.TestCase):
    def test_labels(self) -> None:
        self.assertEqual(generation.ratio_label(1344, 768), "16:9")
        self.assertEqual(generation.ratio_label(768, 1344), "9:16")
        self.assertEqual(generation.ratio_label(1024, 1024), "1:1")
        self.assertEqual(generation.ratio_label(1000, 999), "1:1")
        self.assertEqual(generation.ratio_label(1200, 500), "1200:500")

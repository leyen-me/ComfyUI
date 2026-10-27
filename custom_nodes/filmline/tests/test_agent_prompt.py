"""系统技能：元信息、目录渲染、热发现与按需加载。"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import base  # noqa: F401  (确保 src 进入 sys.path)

from filmline.agent import skills
from filmline.agent.prompt import BASE_PROMPT, system_prompt

VALID = "---\nid: demo\ntitle: 示例\nsummary: 一句话。\nwhen: 需要时。\nversion: 1\n---\n正文\n"


class SkillRegistryTest(unittest.TestCase):
    def test_every_skill_has_complete_metadata(self) -> None:
        self.assertTrue(skills.snapshot())
        for skill in skills.snapshot():
            self.assertTrue(skill.id)
            self.assertTrue(skill.title)
            self.assertTrue(skill.summary)
            self.assertTrue(skill.when)
            self.assertGreaterEqual(skill.version, 1)
            self.assertEqual(skill.filename, f"{skill.id}.md")
            self.assertTrue(skill.text)
            self.assertEqual(skill.chars, len(skill.text))

    def test_ids_are_unique_and_sorted(self) -> None:
        found = skills.ids()
        self.assertEqual(found, sorted(found))
        self.assertEqual(len(found), len(set(found)))
        self.assertIn("h3-prompt", found)

    def test_catalog_matches_registry(self) -> None:
        items = skills.catalog()
        self.assertEqual([item["id"] for item in items], skills.ids())
        for item, skill in zip(items, skills.snapshot()):
            self.assertEqual(item["title"], skill.title)
            self.assertEqual(item["when"], skill.when)
            self.assertEqual(item["chars"], len(skill.text))

    def test_body_is_not_inlined(self) -> None:
        prompt = system_prompt()
        body = skills.get("h3-prompt").text
        self.assertNotIn(body, prompt)
        overhead = sum(
            len(skill.title) + len(skill.summary) + len(skill.when) + 120
            for skill in skills.snapshot()
        )
        self.assertLess(len(prompt), len(BASE_PROMPT) + overhead + 400)

    def test_directory_renders_metadata(self) -> None:
        prompt = system_prompt()
        for skill in skills.snapshot():
            self.assertIn(f'<skill id="{skill.id}" title="{skill.title}"', prompt)
            self.assertIn(skill.summary, prompt)
            self.assertIn(f"何时使用：{skill.when}", prompt)
        self.assertIn("read_skill", prompt)

    def test_prompt_is_stable_between_calls(self) -> None:
        self.assertEqual(system_prompt(), system_prompt())
        self.assertIs(system_prompt(), system_prompt())

    def test_base_prompt_carries_no_domain_spec(self) -> None:
        for duplicated in ("retention_analysis", "scenetrans", "video_mode", "7000 字符"):
            self.assertNotIn(duplicated, BASE_PROMPT)

    def test_h3_skill_covers_hard_constraints(self) -> None:
        text = skills.get("h3-prompt").text
        for needle in (
            "7000 字符",
            "For the target video, at 0.00 seconds into the target video",
            "How the reference pictures align with the target video",
            "integrated_multimodal_description",
            "subject_definitions:",
            "retention_analysis:",
            "fully_preserved",
            "attribute_transfer",
            "partially_copy",
            "<scenetrans>",
            "<cutoff>",
            "No subtitles, no captions, no on-screen text.",
            "[video editing + audio reuse]",
            "4.5 字/秒",
            "17k+5",
        ):
            self.assertIn(needle, text)


class SkillHotReloadTest(unittest.TestCase):
    """新增或修改技能文件后，下一次读取即生效，不需要重启。"""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.registry = skills.Registry(self.dir)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _write(self, name: str, body: str, mtime: int) -> Path:
        path = self.dir / f"{name}.md"
        path.write_text(body, encoding="utf-8")
        # 显式改 mtime，避免同一秒内多次写入导致缓存签名不变
        import os

        os.utime(path, ns=(mtime, mtime))
        return path

    def test_new_file_appears_without_restart(self) -> None:
        self.assertEqual(self.registry.snapshot(), ())
        self._write("demo", VALID, 1_000_000_000)
        self.assertEqual([skill.id for skill in self.registry.snapshot()], ["demo"])

    def test_changed_file_is_reparsed(self) -> None:
        self._write("demo", VALID, 1_000_000_000)
        self.assertEqual(self.registry.snapshot()[0].text, "正文")
        self._write("demo", VALID.replace("正文", "改过的正文"), 2_000_000_000)
        self.assertEqual(self.registry.snapshot()[0].text, "改过的正文")

    def test_invalid_file_is_skipped_and_reported(self) -> None:
        self._write("demo", VALID, 1_000_000_000)
        self._write("broken", "# 没有元信息\n", 1_000_000_000)
        self.assertEqual([skill.id for skill in self.registry.snapshot()], ["demo"])
        problems = self.registry.problems()
        self.assertEqual([item["file"] for item in problems], ["broken.md"])

    def test_unchanged_directory_reuses_snapshot(self) -> None:
        self._write("demo", VALID, 1_000_000_000)
        self.assertIs(self.registry.snapshot(), self.registry.snapshot())

    def test_system_prompt_follows_registry(self) -> None:
        first = (
            skills.Skill(
                id="a-one",
                title="甲",
                summary="甲技能。",
                when="需要甲时。",
                version=1,
                filename="a-one.md",
                text="甲的正文",
            ),
        )
        second = first + (
            skills.Skill(
                id="b-two",
                title="乙",
                summary="乙技能。",
                when="需要乙时。",
                version=1,
                filename="b-two.md",
                text="乙的正文",
            ),
        )
        with mock.patch.object(skills, "snapshot", return_value=first):
            self.assertIn("a-one", system_prompt())
            self.assertNotIn("b-two", system_prompt())
        with mock.patch.object(skills, "snapshot", return_value=second):
            prompt = system_prompt()
            self.assertIn("a-one", prompt)
            self.assertIn("b-two", prompt)
            self.assertNotIn("甲的正文", prompt)


class SkillParseTest(unittest.TestCase):
    """元信息块是模型拿到规范的前提，格式错误必须被识别。"""

    def _parse(self, name: str, body: str):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / f"{name}.md"
            path.write_text(body, encoding="utf-8")
            return skills._parse(path)

    def test_accepts_valid_metadata(self) -> None:
        skill = self._parse(
            "demo",
            "---\nid: demo\ntitle: 示例\nsummary: 一句话。\nwhen: 需要时。\nversion: 3\n---\n正文\n",
        )
        self.assertEqual((skill.id, skill.title, skill.version), ("demo", "示例", 3))
        self.assertEqual(skill.text, "正文")

    def test_rejects_missing_metadata(self) -> None:
        with self.assertRaises(RuntimeError):
            self._parse("demo", "# 没有元信息\n")

    def test_rejects_missing_required_key(self) -> None:
        with self.assertRaises(RuntimeError):
            self._parse(
                "demo",
                "---\nid: demo\ntitle: 示例\nsummary: 一句话。\n---\n正文\n",
            )

    def test_rejects_id_not_matching_filename(self) -> None:
        with self.assertRaises(RuntimeError):
            self._parse(
                "demo",
                "---\nid: other\ntitle: 示例\nsummary: 一句话。\nwhen: 需要时。\n---\n正文\n",
            )

    def test_rejects_metadata_that_breaks_index(self) -> None:
        with self.assertRaises(RuntimeError):
            self._parse(
                "demo",
                "---\nid: demo\ntitle: 示例\nsummary: 带 \"引号\" 的一句话。\nwhen: 需要时。\n---\n正文\n",
            )

    def test_rejects_empty_body(self) -> None:
        with self.assertRaises(RuntimeError):
            self._parse(
                "demo",
                "---\nid: demo\ntitle: 示例\nsummary: 一句话。\nwhen: 需要时。\n---\n\n",
            )


if __name__ == "__main__":
    unittest.main()

"""read_skill 工具：注册、完整读取与错误处理。"""

from __future__ import annotations

import asyncio
import unittest

import base  # noqa: F401  (确保 src 进入 sys.path)

from filmline.agent import skills
from filmline.agent.tools import ToolContext, definitions, execute


def _ctx() -> ToolContext:
    return ToolContext(session_id=1, project_id=1, project_code="T", project_name="测试")


def _call(**arguments: object):
    return asyncio.run(execute("read_skill", arguments, _ctx()))


class ReadSkillToolTest(unittest.TestCase):
    def test_registered_with_open_skill_id(self) -> None:
        # 不把技能 id 写死进 enum，新增技能才能免重启生效
        tool = next(item for item in definitions() if item["function"]["name"] == "read_skill")
        schema = tool["function"]["parameters"]
        self.assertNotIn("enum", schema["properties"]["skill"])
        self.assertEqual(schema["required"], ["skill"])
        self.assertEqual(set(schema["properties"]), {"skill"})

    def test_reads_full_skill(self) -> None:
        skill = skills.get("h3-prompt")
        result = _call(skill="h3-prompt")
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.data["skill"], skill.id)
        self.assertEqual(result.data["title"], skill.title)
        self.assertEqual(result.data["chars"], len(skill.text))
        self.assertEqual(result.data["content"], skill.text)
        self.assertIn("MiniMax H3", result.summary)

    def test_rejects_unknown_skill(self) -> None:
        result = _call(skill="nope")
        self.assertFalse(result.ok)
        self.assertEqual(result.error["code"], "invalid_argument")
        self.assertIn("可用技能", result.error["message"])
        self.assertIn("h3-prompt", result.error["message"])

    def test_rejects_extra_arguments(self) -> None:
        result = _call(skill="h3-prompt", offset=0)
        self.assertFalse(result.ok)
        self.assertEqual(result.error["code"], "invalid_arguments")


if __name__ == "__main__":
    unittest.main()

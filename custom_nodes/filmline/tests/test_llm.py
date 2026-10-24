"""LLM 辅助函数测试（不访问网络）。"""

from __future__ import annotations

import os
import unittest
from unittest.mock import patch

from filmline import llm
from filmline.errors import ServiceUnavailable


class LlmHelpersTest(unittest.TestCase):
    def test_configured(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            self.assertFalse(llm.configured())
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"}):
            self.assertTrue(llm.configured())

    def test_extract_json_plain(self) -> None:
        value = llm._extract_json('{"enhanced_prompt": "x", "warnings": []}')
        self.assertEqual(value["enhanced_prompt"], "x")

    def test_extract_json_fenced(self) -> None:
        value = llm._extract_json('```json\n{"enhanced_prompt": "x"}\n```')
        self.assertEqual(value["enhanced_prompt"], "x")

    def test_extract_json_invalid(self) -> None:
        with self.assertRaises(ServiceUnavailable):
            llm._extract_json("not json")

    def test_missing_key(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            with self.assertRaises(ServiceUnavailable):
                import asyncio

                asyncio.run(llm.optimize_prompt({"prompt": "x"}))


if __name__ == "__main__":
    unittest.main()

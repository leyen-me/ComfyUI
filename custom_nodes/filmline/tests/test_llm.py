"""LLM 辅助函数测试（不访问网络）。"""

from __future__ import annotations

import asyncio
import json
import os
import unittest
from unittest.mock import patch

from filmline import llm
from filmline.errors import ServiceUnavailable


def _reply(enhanced: str, warnings: list[str] | None = None, notes: str = "") -> str:
    return json.dumps(
        {"enhanced_prompt": enhanced, "warnings": warnings or [], "notes": notes},
        ensure_ascii=False,
    )


class _ChatStub:
    """按顺序回放 (content, finish_reason)，并记录每次调用的入参。"""

    def __init__(self, replies: list[tuple[str, str | None]]) -> None:
        self.replies = replies
        self.calls: list[dict] = []

    async def __call__(self, system, payload, images, budget):  # noqa: ANN001
        self.calls.append(
            {"system": system, "payload": payload, "images": images, "budget": budget}
        )
        return self.replies[len(self.calls) - 1]


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

    def test_extract_json_ignores_trailing_prose(self) -> None:
        value = llm._extract_json('好的：{"enhanced_prompt": "a } b"} 以上 {不是 JSON}')
        self.assertEqual(value["enhanced_prompt"], "a } b")

    def test_extract_json_invalid(self) -> None:
        with self.assertRaises(ServiceUnavailable):
            llm._extract_json("not json")

    def test_extract_json_incomplete(self) -> None:
        with self.assertRaises(ServiceUnavailable) as ctx:
            llm._extract_json('{"enhanced_prompt": "cut off')
        self.assertIn("不完整", str(ctx.exception))

    def test_extract_json_tolerates_raw_newlines(self) -> None:
        value = llm._extract_json('{"enhanced_prompt": "line1\nline2"}')
        self.assertIn("line1\nline2", value["enhanced_prompt"])

    def test_missing_key(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_API_KEY": ""}):
            with self.assertRaises(ServiceUnavailable):
                asyncio.run(llm.optimize_prompt({"prompt": "x"}))

    def test_max_tokens_env(self) -> None:
        with patch.dict(os.environ, {"DEEPSEEK_MAX_TOKENS": "2048"}):
            self.assertEqual(llm.max_tokens(), 2048)
        with patch.dict(os.environ, {"DEEPSEEK_MAX_TOKENS": "99999"}):
            self.assertEqual(llm.max_tokens(), llm._MAX_TOKENS_CEILING)
        with patch.dict(os.environ, {"DEEPSEEK_MAX_TOKENS": "oops"}):
            self.assertEqual(llm.max_tokens(), llm._DEFAULT_MAX_TOKENS)


class LlmOptimizeTest(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.dict(os.environ, {"DEEPSEEK_API_KEY": "test-key"})
        patcher.start()
        self.addCleanup(patcher.stop)

    def _run(self, replies: list[tuple[str, str | None]]) -> tuple[dict, _ChatStub]:
        stub = _ChatStub(replies)
        with patch.object(llm, "_chat", new=stub):
            result = asyncio.run(llm.optimize_prompt({"prompt": "draft"}))
        return result, stub

    def test_success(self) -> None:
        result, stub = self._run([(_reply("done", ["提醒"], "说明"), "stop")])
        self.assertEqual(result["enhanced_prompt"], "done")
        self.assertEqual(result["warnings"], ["提醒"])
        self.assertEqual(result["notes"], "说明")
        self.assertEqual(len(stub.calls), 1)
        self.assertEqual(stub.calls[0]["images"], [])
        self.assertLess(stub.calls[0]["budget"], llm._MAX_TOKENS_CEILING + 1)

    def test_retries_once_after_truncation(self) -> None:
        result, stub = self._run(
            [('{"enhanced_prompt": "cut', "length"), (_reply("fixed"), "stop")]
        )
        self.assertEqual(result["enhanced_prompt"], "fixed")
        self.assertEqual(len(stub.calls), 2)
        self.assertIn("previous reply was unusable", stub.calls[1]["system"])
        self.assertEqual(
            stub.calls[1]["budget"],
            min(llm._MAX_TOKENS_CEILING, llm._DEFAULT_MAX_TOKENS * 2),
        )

    def test_retries_once_after_invalid_json(self) -> None:
        result, stub = self._run([("抱歉，我无法输出", "stop"), (_reply("ok"), "stop")])
        self.assertEqual(result["enhanced_prompt"], "ok")
        self.assertEqual(len(stub.calls), 2)

    def test_two_unusable_replies_raise(self) -> None:
        with self.assertRaises(ServiceUnavailable) as ctx:
            self._run([("nope", "stop"), ("still nope", "stop")])
        self.assertIn("合法 JSON", str(ctx.exception))

    def test_truncated_twice_raises_clear_message(self) -> None:
        with self.assertRaises(ServiceUnavailable) as ctx:
            self._run([("", "length"), ('{"enhanced_prompt": "a', "length")])
        self.assertIn("截断", str(ctx.exception))

    def test_warnings_are_trimmed(self) -> None:
        warnings = [f"w{i}" for i in range(20)]
        result, _stub = self._run([(_reply("ok", warnings), "stop")])
        self.assertEqual(len(result["warnings"]), 12)


if __name__ == "__main__":
    unittest.main()

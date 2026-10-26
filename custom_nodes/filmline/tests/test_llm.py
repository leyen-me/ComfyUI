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


class AlignmentInstructionTest(unittest.TestCase):
    """对齐指令由后端确定性生成，不能留占位符。"""

    def test_first_frame_only(self) -> None:
        line = llm.alignment_instruction({"first": True, "last": False}, 5.17)
        self.assertEqual(
            line,
            "For the target video, at 0.00 seconds into the target video, "
            "<Picture 1> (from [Shot 1]) is fully referenced.",
        )

    def test_both_frames_uses_real_duration(self) -> None:
        line = llm.alignment_instruction({"first": True, "last": True}, 12)
        self.assertIn("12.00-second mark", line)
        self.assertIn("Picture 1 (from Shot 1) aligns with the 0.00-second mark", line)
        self.assertNotIn("S.SS", line)

    def test_last_frame_only_belongs_to_final_shot(self) -> None:
        line = llm.alignment_instruction({"first": False, "last": True}, 5.5)
        self.assertIn("<Picture 1> (from [Shot N]) aligns with the 5.50-second mark", line)

    def test_no_frames_returns_empty(self) -> None:
        self.assertEqual(llm.alignment_instruction({"first": False, "last": False}, 5), "")

    def test_invalid_duration_returns_empty(self) -> None:
        for value in (None, "5", True, 0, -1):
            self.assertEqual(
                llm.alignment_instruction({"first": True, "last": True}, value), ""
            )

    def test_prepare_payload_injects_only_for_keyframes(self) -> None:
        payload = {
            "video_mode": "keyframes",
            "keyframes": {"first": True, "last": True},
            "duration": 5.17,
        }
        prepared = llm._prepare_payload(payload)
        self.assertIn("alignment_instruction", prepared)
        self.assertNotIn("alignment_instruction", payload)

        reference = llm._prepare_payload(
            {"video_mode": "reference", "keyframes": {"first": True, "last": True}, "duration": 5}
        )
        self.assertNotIn("alignment_instruction", reference)


class SystemPromptTest(unittest.TestCase):
    """规范必须写进系统提示，否则模型会退回旧写法。"""

    def test_reference_mode_forbids_extra_subtitle_section(self) -> None:
        self.assertIn("Do not append a no-subtitles line", llm.SYSTEM_PROMPT)

    def test_forbids_per_second_bullets(self) -> None:
        self.assertIn("00:01.0 - ...", llm.SYSTEM_PROMPT)

    def test_requires_bracketed_task_type(self) -> None:
        self.assertIn("[video editing + audio reuse]", llm.SYSTEM_PROMPT)

    def test_requires_global_style_sentence(self) -> None:
        self.assertIn("global visual style", llm.SYSTEM_PROMPT)

    def test_requires_l2va_last_frame_rule(self) -> None:
        self.assertIn("belongs to the final shot", llm.SYSTEM_PROMPT)

    def test_forbids_inventing_reference_features(self) -> None:
        self.assertIn("never invent facial details", llm.SYSTEM_PROMPT)

    def test_dialogue_length_guidance(self) -> None:
        self.assertIn("4-5 Chinese characters", llm.SYSTEM_PROMPT)

    def test_retention_line_format(self) -> None:
        self.assertIn("(appears in [Shot 1], [Shot 3]): fully_preserved", llm.SYSTEM_PROMPT)

    def test_scenetrans_and_cutoff(self) -> None:
        self.assertIn("<scenetrans>", llm.SYSTEM_PROMPT)
        self.assertIn("<cutoff>", llm.SYSTEM_PROMPT)

    def test_final_shot_reaches_last_frame(self) -> None:
        self.assertIn("reach the last frame exactly when the video ends", llm.SYSTEM_PROMPT)


    def test_picture_only_as_look_source_becomes_subject(self) -> None:
        self.assertIn("Reserve <Picture N> for a picture used as a concrete frame", llm.SYSTEM_PROMPT)
        self.assertIn("do NOT give it its own line", llm.SYSTEM_PROMPT)


    def test_retention_uses_only_defined_labels(self) -> None:
        self.assertIn("Use exactly the labels defined in subject_definitions", llm.SYSTEM_PROMPT)

    def test_reframed_location_is_partially_preserved(self) -> None:
        self.assertIn("a location reference that gets reframed", llm.SYSTEM_PROMPT)

    def test_no_subtitles_is_conditional(self) -> None:
        self.assertIn("only when the metadata field `no_subtitles` is true", llm.SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()

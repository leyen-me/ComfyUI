"""Agent 核心测试：事件序号、原文还原、工具账本、暂停与问答。"""

from __future__ import annotations

import asyncio
import json
import os
import unittest
from unittest import mock

from base import AsyncDbTestCase, DbTestCase
from filmline import config
from filmline.agent import store
from filmline.agent.engine import AgentEngine
from filmline.agent.provider import StreamClient
from filmline.agent.schema import SchemaError, validate
from filmline.agent.tools.base import ToolContext, ToolOutcome
from filmline.config import AgentSettings
from filmline.domain.projects import ProjectService
from filmline.domain.schemas import ProjectCreate


def _settings(**overrides) -> AgentSettings:
    base = dict(
        api_key="test",
        base_url="https://api.deepseek.com",
        model="deepseek-flash",
        thinking="auto",
        reasoning_effort="high",
        context_window=1_000_000,
        max_tokens=8192,
        timeout=300,
        tick_seconds=300,
    )
    base.update(overrides)
    return AgentSettings(**base)


class ThinkingConfigTest(unittest.TestCase):
    def test_thinking_tristate_and_effort_normalization(self) -> None:
        with mock.patch.dict(os.environ, {"FILMLINE_AGENT_API_KEY": "k"}, clear=True):
            default = config.agent_settings()
            self.assertEqual(default.thinking, "auto")
            self.assertEqual(default.reasoning_effort, "high")

        with mock.patch.dict(
            os.environ,
            {
                "FILMLINE_AGENT_API_KEY": "k",
                "FILMLINE_AGENT_THINKING": "1",
                "FILMLINE_AGENT_REASONING_EFFORT": "medium",
            },
            clear=True,
        ):
            enabled = config.agent_settings()
            self.assertEqual(enabled.thinking, "enabled")
            self.assertEqual(enabled.reasoning_effort, "medium")

        with mock.patch.dict(
            os.environ,
            {
                "FILMLINE_AGENT_API_KEY": "k",
                "FILMLINE_AGENT_THINKING": "0",
                "FILMLINE_AGENT_REASONING_EFFORT": "不存在的值",
            },
            clear=True,
        ):
            disabled = config.agent_settings()
            self.assertEqual(disabled.thinking, "disabled")
            self.assertEqual(disabled.reasoning_effort, "high")

    def test_request_body_matches_official_shape(self) -> None:
        messages = [{"role": "user", "content": "hi"}]
        tools = [{"type": "function", "function": {"name": "x", "parameters": {}}}]

        auto = StreamClient(_settings()).request_body(messages, tools)
        self.assertNotIn("thinking", auto)
        self.assertNotIn("reasoning_effort", auto)
        self.assertNotIn("temperature", auto)
        self.assertTrue(auto["stream"])
        self.assertEqual(auto["tool_choice"], "auto")

        enabled = StreamClient(_settings(thinking="enabled", reasoning_effort="max")).request_body(
            messages, tools
        )
        self.assertEqual(enabled["thinking"], {"type": "enabled"})
        self.assertEqual(enabled["reasoning_effort"], "max")

        disabled = StreamClient(_settings(thinking="disabled")).request_body(messages, tools)
        self.assertEqual(disabled["thinking"], {"type": "disabled"})
        self.assertNotIn("reasoning_effort", disabled)

        # 会话级覆盖优先于全局配置
        overridden = StreamClient(_settings()).request_body(
            messages, tools, thinking="enabled", effort="low"
        )
        self.assertEqual(overridden["thinking"], {"type": "enabled"})
        self.assertEqual(overridden["reasoning_effort"], "low")
        off = StreamClient(_settings(thinking="enabled")).request_body(
            messages, tools, thinking="disabled"
        )
        self.assertEqual(off["thinking"], {"type": "disabled"})
        self.assertNotIn("reasoning_effort", off)


class SchemaTest(unittest.TestCase):
    def test_required_and_extra(self) -> None:
        schema = {
            "type": "object",
            "properties": {"name": {"type": "string", "minLength": 1}},
            "required": ["name"],
            "additionalProperties": False,
        }
        self.assertEqual(validate({"name": "a"}, schema), {"name": "a"})
        with self.assertRaises(SchemaError):
            validate({}, schema)
        with self.assertRaises(SchemaError):
            validate({"name": "a", "evil": 1}, schema)

    def test_nested_and_defaults(self) -> None:
        schema = {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {"id": {"type": "integer", "minimum": 1}},
                        "required": ["id"],
                        "additionalProperties": False,
                    },
                },
                "limit": {"type": "integer", "default": 10},
            },
        }
        self.assertEqual(validate({"items": [{"id": 2}]}, schema), {"items": [{"id": 2}], "limit": 10})
        with self.assertRaises(SchemaError):
            validate({"items": [{"id": 0}]}, schema)


class AgentStoreTest(DbTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.project = ProjectService().create(ProjectCreate(name="测试项目"))
        self.session = store.create_session(
            self.project.id, title="新对话", model="deepseek-flash", context_window=1_000_000
        )

    def test_events_and_messages_keep_raw_text(self) -> None:
        first = store.append_event(self.session.id, "content.delta", {"text": "第一行\n\n  第二行\t"})
        second = store.append_event(self.session.id, "content.delta", {"text": "末尾"})
        self.assertEqual((first["seq"], second["seq"]), (1, 2))

        replay = store.list_events(self.session.id, after=1)
        self.assertEqual(len(replay), 1)
        self.assertEqual(replay[0]["data"]["text"], "末尾")

        raw = "hello\r\n\n  world  "
        store.append_message(
            self.session.id,
            turn=1,
            role="assistant",
            content=raw,
            reasoning="思考\n换行",
            tool_calls_raw='[{"id":"call_1","type":"function","function":{"name":"x","arguments":"{\\"a\\": 1}"}}]',
        )
        rows = store.list_messages(self.session.id)
        self.assertEqual(rows[0].content, raw)
        self.assertEqual(rows[0].reasoning, "思考\n换行")
        self.assertIn('"arguments":"{\\"a\\": 1}"', rows[0].tool_calls_raw or "")

    def test_session_thinking_defaults_and_update(self) -> None:
        info = store.get_session(self.session.id)
        self.assertEqual((info.thinking, info.reasoning_effort), ("auto", "high"))
        store.update_session(self.session.id, thinking="enabled", reasoning_effort="max")
        info = store.get_session(self.session.id)
        self.assertEqual((info.thinking, info.reasoning_effort), ("enabled", "max"))

    def test_ledger_is_idempotent(self) -> None:
        self.assertTrue(store.ledger_start(self.session.id, "call_1", "read_image"))
        self.assertFalse(store.ledger_start(self.session.id, "call_1", "read_image"))
        store.ledger_finish(self.session.id, "call_1", status="ok", result_raw='{"ok":true}')
        self.assertEqual(store.ledger_result(self.session.id, "call_1"), ("ok", '{"ok":true}'))

    def test_build_messages_returns_reasoning_and_raw_arguments(self) -> None:
        store.append_message(
            self.session.id,
            turn=1,
            role="assistant",
            content="",
            reasoning="先看图",
            tool_calls_raw='[{"id":"call_1","type":"function","function":{"name":"read_image","arguments":"{\\"asset_id\\": 1}"}}]',
        )
        store.append_message(
            self.session.id,
            turn=1,
            role="tool",
            content='{"ok":true}',
            tool_call_id="call_1",
            tool_name="read_image",
        )
        engine = AgentEngine(settings=_settings())
        messages = engine._build_messages(self.session.id)
        assistant = next(item for item in messages if item["role"] == "assistant")
        self.assertEqual(assistant["reasoning_content"], "先看图")
        self.assertEqual(
            assistant["tool_calls"][0]["function"]["arguments"], '{"asset_id": 1}'
        )
        tool = next(item for item in messages if item["role"] == "tool")
        self.assertEqual(tool["tool_call_id"], "call_1")

    def test_build_messages_uses_file_block_and_trims_old_images(self) -> None:
        for index in range(30):
            image: dict = {
                "label": f"img{index}",
                "data_url": "data:image/jpeg;base64,AA",
            }
            if index == 29:
                image.update(
                    file_id="file-api-test",
                    file_expires_at="2099-01-01T00:00:00Z",
                )
            store.append_message(
                self.session.id,
                turn=1,
                role="user",
                content=f"图片 {index}",
                meta={"synthetic": "tool_images", "images": [image]},
            )

        engine = AgentEngine(settings=_settings())
        messages = engine._build_messages(self.session.id)
        user_messages = [item for item in messages if item["role"] == "user"]
        self.assertEqual(len(user_messages), 30)
        self.assertIn("移除以控制请求体", user_messages[0]["content"])
        self.assertEqual(len(user_messages[-1]["content"]), 2)
        self.assertEqual(user_messages[-1]["content"][1], {"type": "file", "file_id": "file-api-test"})
        image_parts = sum(
            1
            for item in user_messages
            if isinstance(item["content"], list)
            for part in item["content"]
            if part.get("type") in ("image_url", "file")
        )
        self.assertEqual(image_parts, 24)

    def test_build_messages_moves_tool_results_before_image_observation(self) -> None:
        """历史里被图片 user 消息插开的 tool 结果，重建时必须前移成连续块。"""
        store.append_message(
            self.session.id,
            turn=1,
            role="assistant",
            content="",
            reasoning="看两张图",
            tool_calls_raw=json.dumps(
                [
                    {"id": "c1", "type": "function", "function": {"name": "read_image", "arguments": "{}"}},
                    {"id": "c2", "type": "function", "function": {"name": "read_image", "arguments": "{}"}},
                ]
            ),
        )
        store.append_message(
            self.session.id, turn=1, role="tool", content="{}", tool_call_id="c1", tool_name="read_image"
        )
        store.append_message(
            self.session.id,
            turn=1,
            role="user",
            content="图片 1",
            meta={"synthetic": "tool_images", "images": [{"label": "a", "data_url": "data:image/jpeg;base64,AA"}]},
        )
        store.append_message(
            self.session.id, turn=1, role="tool", content="{}", tool_call_id="c2", tool_name="read_image"
        )
        store.append_message(
            self.session.id,
            turn=1,
            role="user",
            content="图片 2",
            meta={"synthetic": "tool_images", "images": [{"label": "b", "data_url": "data:image/jpeg;base64,BB"}]},
        )
        engine = AgentEngine(settings=_settings())
        messages = engine._build_messages(self.session.id)
        roles = [item["role"] for item in messages]
        self.assertEqual(roles, ["system", "assistant", "tool", "tool", "user", "user"])
        self.assertEqual(messages[2]["tool_call_id"], "c1")
        self.assertEqual(messages[3]["tool_call_id"], "c2")

    def test_notify_accepts_positional_percent(self) -> None:
        received: list[tuple] = []

        async def progress(text: str, percent: int | None) -> None:
            received.append((text, percent))

        ctx = ToolContext(
            session_id=1,
            project_id=1,
            project_code="PRJ-0001",
            project_name="测试",
            progress=progress,
        )
        asyncio.run(ctx.notify("拼图", 20))
        self.assertEqual(received, [("拼图", 20)])

    def test_mark_interrupted_returns_session_ids(self) -> None:
        store.update_session(self.session.id, status="running")
        self.assertEqual(store.mark_interrupted(), [self.session.id])
        self.assertEqual(store.get_session(self.session.id).status, "interrupted")

    def test_pending_tool_calls_detected(self) -> None:
        store.append_message(
            self.session.id,
            turn=1,
            role="assistant",
            content="",
            tool_calls_raw=json.dumps(
                [
                    {"id": "call_1", "type": "function", "function": {"name": "a", "arguments": "{}"}},
                    {"id": "call_2", "type": "function", "function": {"name": "b", "arguments": "{}"}},
                ]
            ),
        )
        store.append_message(
            self.session.id,
            turn=1,
            role="tool",
            content="{}",
            tool_call_id="call_1",
            tool_name="a",
        )
        self.assertEqual(store.pending_tool_calls(self.session.id), [("call_2", "b")])


class FakeClient:
    def __init__(self, scripts: list[list[dict]]) -> None:
        self._scripts = scripts
        self.calls = 0

    async def stream(self, messages, tools, **kwargs):
        index = min(self.calls, len(self._scripts) - 1)
        self.calls += 1
        for event in self._scripts[index]:
            yield event


class SlowClient:
    def __init__(self) -> None:
        self.release = asyncio.Event()

    async def stream(self, messages, tools, **kwargs):
        yield {"type": "content", "text": "只写了一半"}
        await self.release.wait()
        yield {
            "type": "done",
            "content": "只写了一半，然后结束",
            "reasoning": "思考",
            "tool_calls": [],
            "usage": {},
        }


class AgentEngineTest(AsyncDbTestCase):
    async def asyncSetUp(self) -> None:
        await super().asyncSetUp()
        self.project = ProjectService().create(ProjectCreate(name="测试项目"))
        self.session = store.create_session(
            self.project.id, title="新对话", model="deepseek-flash", context_window=1_000_000
        )

    def _user(self, text: str) -> None:
        store.update_session(self.session.id, turn=1)
        store.append_message(self.session.id, turn=1, role="user", content=text)

    async def _run(self, engine: AgentEngine) -> None:
        await engine.start_session(self.session.id)
        task = engine._runs[self.session.id].task
        await asyncio.wait_for(task, timeout=5)

    async def test_plain_answer(self) -> None:
        self._user("你好")
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {"type": "reasoning", "text": "想一想"},
                    {"type": "content", "text": "你好，我是 Agent。"},
                    {
                        "type": "done",
                        "content": "你好，我是 Agent。",
                        "reasoning": "想一想",
                        "tool_calls": [],
                        "usage": {"prompt_tokens": 120, "completion_tokens": 20},
                    },
                ]
            ]
        )
        await self._run(engine)
        info = store.get_session(self.session.id)
        self.assertEqual(info.status, "idle")
        self.assertEqual(info.usage["prompt_tokens"], 120)
        rows = store.list_messages(self.session.id)
        self.assertEqual(rows[-1].role, "assistant")
        self.assertEqual(rows[-1].content, "你好，我是 Agent。")
        self.assertEqual(rows[-1].reasoning, "想一想")

    async def test_tool_call_round_trip(self) -> None:
        self._user("项目里有什么")
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {
                        "type": "done",
                        "content": "",
                        "reasoning": "先看上下文",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "get_workspace_context", "arguments": "{}"},
                            }
                        ],
                        "usage": {},
                    }
                ],
                [
                    {
                        "type": "done",
                        "content": "项目里有一个分集。",
                        "reasoning": "读完了",
                        "tool_calls": [],
                        "usage": {},
                    }
                ],
            ]
        )
        await self._run(engine)
        rows = store.list_messages(self.session.id)
        tool_rows = [row for row in rows if row.role == "tool"]
        self.assertEqual(len(tool_rows), 1)
        payload = json.loads(tool_rows[0].content)
        self.assertTrue(payload["ok"])
        self.assertEqual(store.get_session(self.session.id).status, "idle")
        events = store.list_events(self.session.id)
        self.assertTrue(any(event["type"] == "tool.finished" for event in events))

    async def test_multiple_image_tools_keep_tool_block_contiguous(self) -> None:
        self._user("看看这两张图")
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {
                        "type": "done",
                        "content": "",
                        "reasoning": "看图",
                        "tool_calls": [
                            {
                                "id": "c1",
                                "type": "function",
                                "function": {"name": "read_image", "arguments": '{"asset_id":1}'},
                            },
                            {
                                "id": "c2",
                                "type": "function",
                                "function": {"name": "read_image", "arguments": '{"asset_id":2}'},
                            },
                        ],
                        "usage": {},
                    }
                ],
                [
                    {
                        "type": "done",
                        "content": "都看完了。",
                        "reasoning": "",
                        "tool_calls": [],
                        "usage": {},
                    }
                ],
            ]
        )

        async def fake_execute(name, arguments, ctx):
            return ToolOutcome(
                summary="已读取",
                data={"asset_id": arguments["asset_id"]},
                images=[
                    {
                        "label": f"图{arguments['asset_id']}",
                        "data_url": "data:image/jpeg;base64,AA",
                    }
                ],
            )

        with mock.patch("filmline.agent.engine.execute", side_effect=fake_execute):
            await self._run(engine)

        rows = store.list_messages(self.session.id)
        roles = [row.role for row in rows]
        self.assertEqual(roles, ["user", "assistant", "tool", "tool", "user", "assistant"])
        self.assertEqual([row.tool_call_id for row in rows[2:4]], ["c1", "c2"])
        images = (rows[4].meta or {}).get("images") or []
        self.assertEqual(len(images), 2)

    async def test_pause_discards_partial_step(self) -> None:
        self._user("写点什么")
        engine = AgentEngine()
        client = SlowClient()
        engine._client = client
        await engine.start_session(self.session.id)
        task = engine._runs[self.session.id].task
        for _ in range(50):
            await asyncio.sleep(0.02)
            if any(e["type"] == "content.delta" for e in store.list_events(self.session.id)):
                break
        await engine.pause_session(self.session.id)
        await asyncio.wait_for(task, timeout=5)
        info = store.get_session(self.session.id)
        self.assertEqual(info.status, "paused")
        events = store.list_events(self.session.id)
        self.assertTrue(any(e["type"] == "step.discarded" for e in events))
        self.assertFalse(any(row.role == "assistant" for row in store.list_messages(self.session.id)))

    async def test_question_answer_flow(self) -> None:
        self._user("做个视频")
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {
                        "type": "done",
                        "content": "",
                        "reasoning": "",
                        "tool_calls": [
                            {
                                "id": "call_q",
                                "type": "function",
                                "function": {
                                    "name": "ask_question",
                                    "arguments": json.dumps(
                                        {
                                            "questions": [
                                                {
                                                    "id": "ratio",
                                                    "header": "画幅",
                                                    "question": "要横屏还是竖屏？",
                                                    "options": [{"label": "16:9"}, {"label": "9:16"}],
                                                }
                                            ]
                                        },
                                        ensure_ascii=False,
                                    ),
                                },
                            }
                        ],
                        "usage": {},
                    }
                ],
                [
                    {
                        "type": "done",
                        "content": "好的，按竖屏来做。",
                        "reasoning": "",
                        "tool_calls": [],
                        "usage": {},
                    }
                ],
            ]
        )
        await engine.start_session(self.session.id)
        task = engine._runs[self.session.id].task
        for _ in range(100):
            await asyncio.sleep(0.02)
            if store.get_session(self.session.id).status == "waiting_input":
                break
        self.assertEqual(store.get_session(self.session.id).status, "waiting_input")
        accepted = await engine.answer(self.session.id, "call_q", {"ratio": "9:16"})
        self.assertTrue(accepted)
        await asyncio.wait_for(task, timeout=5)
        rows = store.list_messages(self.session.id)
        tool_row = next(row for row in rows if row.role == "tool")
        self.assertIn("9:16", tool_row.content)
        self.assertEqual(store.get_session(self.session.id).status, "idle")

    async def test_pause_while_question_marks_tool_paused(self) -> None:
        self._user("做个视频")
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {
                        "type": "done",
                        "content": "",
                        "reasoning": "",
                        "tool_calls": [
                            {
                                "id": "call_q",
                                "type": "function",
                                "function": {
                                    "name": "ask_question",
                                    "arguments": json.dumps(
                                        {
                                            "questions": [
                                                {
                                                    "id": "x",
                                                    "header": "确认",
                                                    "question": "继续吗？",
                                                    "options": [{"label": "继续"}],
                                                }
                                            ]
                                        },
                                        ensure_ascii=False,
                                    ),
                                },
                            }
                        ],
                        "usage": {},
                    }
                ]
            ]
        )
        await engine.start_session(self.session.id)
        task = engine._runs[self.session.id].task
        for _ in range(100):
            await asyncio.sleep(0.02)
            if store.get_session(self.session.id).status == "waiting_input":
                break
        await engine.pause_session(self.session.id)
        await asyncio.wait_for(task, timeout=5)
        self.assertEqual(store.get_session(self.session.id).status, "paused")
        tool_row = next(
            row for row in store.list_messages(self.session.id) if row.role == "tool"
        )
        self.assertIn('"code":"paused"', tool_row.content)
        events = store.list_events(self.session.id)
        finished = [e for e in events if e["type"] == "tool.finished"]
        self.assertEqual(finished[-1]["data"]["status"], "paused")

    async def test_resume_continues_step_numbering(self) -> None:
        """恢复同一轮时 step 从已落库数量继续，避免前端覆盖旧 step。"""
        self._user("继续")
        store.append_message(
            self.session.id,
            turn=1,
            role="assistant",
            content="上一步",
            reasoning="",
        )
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {
                        "type": "done",
                        "content": "新回答",
                        "reasoning": "",
                        "tool_calls": [],
                        "usage": {},
                    }
                ]
            ]
        )
        await self._run(engine)
        events = store.list_events(self.session.id)
        steps = [
            event["data"]["step"]
            for event in events
            if event["type"] == "step.started"
        ]
        self.assertEqual(steps, [1])
        finished = [event for event in events if event["type"] == "step.finished"]
        self.assertEqual(finished[-1]["data"]["step"], 1)

    async def test_repair_fills_interrupted_tool_result(self) -> None:
        self._user("继续")
        store.append_message(
            self.session.id,
            turn=1,
            role="assistant",
            content="",
            tool_calls_raw=json.dumps(
                [
                    {
                        "id": "call_lost",
                        "type": "function",
                        "function": {"name": "read_image", "arguments": '{"asset_id": 99}'},
                    }
                ]
            ),
        )
        engine = AgentEngine()
        engine._client = FakeClient(
            [
                [
                    {
                        "type": "done",
                        "content": "上次工具中断了。",
                        "reasoning": "",
                        "tool_calls": [],
                        "usage": {},
                    }
                ]
            ]
        )
        await self._run(engine)
        rows = store.list_messages(self.session.id)
        tool_rows = [row for row in rows if row.role == "tool"]
        self.assertEqual(len(tool_rows), 1)
        self.assertIn("interrupted", tool_rows[0].content)


if __name__ == "__main__":
    unittest.main()

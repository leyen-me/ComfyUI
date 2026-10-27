"""Agent 运行循环。

一次 ``run`` 会在后端常驻执行，浏览器只是订阅者：

* 模型流式输出 thinking / content；
* assistant 的 tool_calls 逐个执行，执行过程推送进度；
* 工具结果原样入库，再进入下一轮推理；
* 暂停会中断模型请求与当前工具，并给工具写入 paused 错误结果；
* 重启后从消息表继续，账本保证工具不重复执行。
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from aiohttp import web

from .. import config
from ..config import AgentSettings
from ..domain.projects import ProjectService
from . import store
from .bus import BUS
from .prompt import system_prompt
from .provider import ProviderError, StreamClient
from .tools import ToolContext, definitions, execute, failure, get

_LOG = logging.getLogger("filmline")

MAX_STEPS = 32
DELTA_FLUSH_CHARS = 1200
DELTA_FLUSH_SECONDS = 0.12
ENGINE_KEY = "filmline_agent_engine"
# 官方单请求 600 张 / 64 MiB；Agent 侧收得更紧，避免长会话无限膨胀
MAX_CONTEXT_IMAGES = 24
MAX_CONTEXT_IMAGE_BYTES = 24 * 1024 * 1024


class _Paused(Exception):
    pass


@dataclass
class _Run:
    session_id: int
    task: asyncio.Task
    pause: asyncio.Event = field(default_factory=asyncio.Event)
    stream_task: asyncio.Task | None = None
    tool_task: asyncio.Task | None = None
    current_tool_call: str | None = None
    tool_pause_ids: set[str] = field(default_factory=set)
    question_future: asyncio.Future | None = None
    question_call_id: str | None = None
    stopping: bool = False
    # 本次工具调用读到终态的任务；结果落库后才标记，避免“读到但没返回”时漏报
    observed_task_ids: list[int] = field(default_factory=list)


@dataclass
class _Delta:
    content: list[str] = field(default_factory=list)
    reasoning: list[str] = field(default_factory=list)
    last_flush: float = field(default_factory=time.monotonic)


def _file_block_valid(image: dict) -> bool:
    file_id = image.get("file_id")
    if not isinstance(file_id, str) or not file_id:
        return False
    expires = image.get("file_expires_at")
    if not expires:
        return True
    try:
        value = datetime.fromisoformat(str(expires).replace("Z", "+00:00"))
    except ValueError:
        return False
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value > datetime.now(timezone.utc)


def _image_messages_to_keep(rows: list[store.StoredMessage]) -> set[int]:
    """从最新往回保留图片观察，控制张数与内联字节数；旧图片降级为文本提示。"""
    keep: set[int] = set()
    count = 0
    total_bytes = 0
    for row in reversed(rows):
        if row.role != "user":
            continue
        images = (row.meta or {}).get("images") or []
        if not images:
            continue
        inline_bytes = sum(
            len(image.get("data_url") or "")
            for image in images
            if not _file_block_valid(image)
        )
        if (
            count + len(images) > MAX_CONTEXT_IMAGES
            or total_bytes + inline_bytes > MAX_CONTEXT_IMAGE_BYTES
        ):
            continue
        keep.add(row.seq)
        count += len(images)
        total_bytes += inline_bytes
    return keep


def _canonical_rows(rows: list[store.StoredMessage]) -> list[store.StoredMessage]:
    """把历史消息整理成合法顺序。

    OpenAI/DeepSeek 要求 assistant 的 ``tool_calls`` 后面紧跟所有对应的 tool 消息；
    早期版本会在一组工具结果之间插入图片 user 消息，导致 400。这里在重建请求时
    把 tool 结果按调用顺序前移，其余消息（图片观察）排在其后。
    正确顺序的历史不会被改动。
    """
    ordered: list[store.StoredMessage] = []
    index = 0
    while index < len(rows):
        row = rows[index]
        if row.role == "assistant" and row.tool_calls_raw:
            try:
                calls = json.loads(row.tool_calls_raw)
            except json.JSONDecodeError:
                calls = []
            call_ids = [
                str(call.get("id"))
                for call in calls
                if isinstance(call, dict) and call.get("id")
            ]
            ordered.append(row)
            index += 1
            block: list[store.StoredMessage] = []
            while index < len(rows) and rows[index].role != "assistant":
                block.append(rows[index])
                index += 1
            by_id = {
                item.tool_call_id: item
                for item in block
                if item.role == "tool" and item.tool_call_id in call_ids
            }
            for call_id in call_ids:
                if call_id in by_id:
                    ordered.append(by_id[call_id])
            for item in block:
                if item.role == "tool" and item.tool_call_id in call_ids:
                    continue
                ordered.append(item)
        else:
            ordered.append(row)
            index += 1
    return ordered


class AgentEngine:
    def __init__(self, settings: AgentSettings | None = None) -> None:
        self._settings = settings or config.agent_settings()
        self._client = StreamClient(self._settings)
        self._runs: dict[int, _Run] = {}
        self._task_runner: Any = None
        self._notifier: asyncio.Task | None = None
        self._known_task_states: dict[int, str] = {}

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------

    def bind_runner(self, runner: Any) -> None:
        self._task_runner = runner

    async def start(self, app: web.Application) -> None:
        app[ENGINE_KEY] = self
        try:
            interrupted = await asyncio.to_thread(store.mark_interrupted)
            if interrupted:
                _LOG.info("标记 %s 个中断的 Agent 会话", interrupted)
            # 补发状态事件：否则客户端重连回放时看不到 interrupted，
            # 界面会停留在旧的 running、看起来像卡死。
            for session_id in interrupted:
                try:
                    event = await asyncio.to_thread(
                        store.append_event,
                        session_id,
                        "session.status",
                        {"status": "interrupted"},
                    )
                    BUS.publish(session_id, event)
                except Exception:
                    _LOG.exception("写入 interrupted 状态事件失败: session=%s", session_id)
        except Exception:
            _LOG.exception("恢复 Agent 会话状态失败")
        self._notifier = asyncio.create_task(self._notify_loop(), name="filmline-agent-notify")

    async def stop(self, app: web.Application) -> None:
        if self._notifier is not None:
            self._notifier.cancel()
            await asyncio.gather(self._notifier, return_exceptions=True)
            self._notifier = None
        runs = list(self._runs.values())
        for run in runs:
            run.stopping = True
            run.pause.set()
            run.task.cancel()
        if runs:
            await asyncio.gather(*[run.task for run in runs], return_exceptions=True)
        self._runs.clear()

    def running(self, session_id: int) -> bool:
        run = self._runs.get(session_id)
        return run is not None and not run.task.done()

    # ------------------------------------------------------------------
    # 控制
    # ------------------------------------------------------------------

    async def start_session(self, session_id: int) -> None:
        if self.running(session_id):
            return
        info = await asyncio.to_thread(store.get_session, session_id)
        if info.status == "running":
            await asyncio.to_thread(store.set_status, session_id, "idle")
        await asyncio.to_thread(store.set_status, session_id, "running")
        task = asyncio.create_task(
            self._run(session_id), name=f"filmline-agent-{session_id}"
        )
        run = _Run(session_id=session_id, task=task)
        self._runs[session_id] = run

        def _done(_: asyncio.Task) -> None:
            self._runs.pop(session_id, None)

        task.add_done_callback(_done)

    async def pause_session(self, session_id: int) -> bool:
        run = self._runs.get(session_id)
        if run is None or run.task.done():
            await asyncio.to_thread(store.set_status, session_id, "paused")
            return False
        run.pause.set()
        if run.stream_task is not None and not run.stream_task.done():
            run.stream_task.cancel()
        if run.tool_task is not None and not run.tool_task.done():
            run.tool_task.cancel()
        return True

    async def pause_tool(self, session_id: int, tool_call_id: str) -> bool:
        run = self._runs.get(session_id)
        if run is None or run.task.done():
            return False
        if run.current_tool_call != tool_call_id or run.tool_task is None:
            return False
        run.tool_pause_ids.add(tool_call_id)
        run.tool_task.cancel()
        return True

    async def answer(self, session_id: int, tool_call_id: str, answers: dict) -> bool:
        run = self._runs.get(session_id)
        if run is None or run.question_future is None or run.question_future.done():
            return False
        if run.question_call_id and run.question_call_id != tool_call_id:
            return False
        run.question_future.set_result(answers)
        return True

    # ------------------------------------------------------------------
    # 事件 / 消息
    # ------------------------------------------------------------------

    async def _emit(self, session_id: int, event_type: str, data: dict) -> dict:
        event = await asyncio.to_thread(store.append_event, session_id, event_type, data)
        BUS.publish(session_id, event)
        return event

    async def _set_status(self, session_id: int, status: str) -> None:
        await asyncio.to_thread(store.set_status, session_id, status)
        await self._emit(session_id, "session.status", {"status": status})

    async def notify(self, session_id: int, text: str, *, source: str = "task") -> bool:
        """代替用户发送一条专业通知，并让 Agent 自检。

        返回 False 表示会话还在忙，通知没有写入；调用方应保留待通知状态，
        等会话空闲后的下一个 tick 再发，而不是直接标记为已通知。
        """
        info = await asyncio.to_thread(store.get_session, session_id)
        if info.status not in ("idle", "error"):
            return False
        turn = info.turn + 1
        await asyncio.to_thread(store.update_session, session_id, turn=turn)
        await asyncio.to_thread(
            store.append_message,
            session_id,
            turn=turn,
            role="user",
            content=text,
            meta={"synthetic": "notice", "source": source},
        )
        await self._emit(session_id, "notice", {"text": text, "source": source, "turn": turn})
        await self.start_session(session_id)
        return True

    # ------------------------------------------------------------------
    # 上下文
    # ------------------------------------------------------------------

    def _build_messages(self, session_id: int) -> list[dict[str, Any]]:
        messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt()}]
        rows = _canonical_rows(store.list_messages(session_id))
        keep_images = _image_messages_to_keep(rows)
        for row in rows:
            if row.role == "assistant":
                item: dict[str, Any] = {
                    "role": "assistant",
                    "content": row.content,
                    # 带 tools 时必须回传 reasoning_content（DeepSeek 官方要求）
                    "reasoning_content": row.reasoning,
                }
                if row.tool_calls_raw:
                    try:
                        item["tool_calls"] = json.loads(row.tool_calls_raw)
                    except json.JSONDecodeError:
                        item["tool_calls"] = []
                messages.append(item)
            elif row.role == "tool":
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": row.tool_call_id or "",
                        "content": row.content,
                    }
                )
            elif row.role == "user":
                images = (row.meta or {}).get("images") or []
                if images:
                    if row.seq not in keep_images:
                        messages.append(
                            {
                                "role": "user",
                                "content": (
                                    f"{row.content}\n\n"
                                    "[较早的图片已从上下文移除以控制请求体]"
                                ).strip(),
                            }
                        )
                        continue
                    parts: list[dict[str, Any]] = [
                        {"type": "text", "text": row.content or "请查看以下图片。"}
                    ]
                    for image in images:
                        if _file_block_valid(image):
                            parts.append({"type": "file", "file_id": image["file_id"]})
                        elif image.get("data_url"):
                            parts.append(
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": image["data_url"],
                                        "detail": image.get("detail") or "high",
                                    },
                                }
                            )
                    messages.append({"role": "user", "content": parts})
                else:
                    messages.append({"role": "user", "content": row.content})
        return messages

    # ------------------------------------------------------------------
    # 主循环
    # ------------------------------------------------------------------

    async def _run(self, session_id: int) -> None:
        run = self._runs.get(session_id)
        if run is None:
            return
        try:
            await self._repair(session_id)
            info = await asyncio.to_thread(store.get_session, session_id)
            turn = info.turn
            # 恢复同一轮时从已落库的 step 数继续编号；否则重新从 0 开始，
            # 会覆盖前端上一轮已完成/半截的 step。
            step_offset = await asyncio.to_thread(
                store.assistant_steps_in_turn, session_id, turn
            )
            await self._emit(session_id, "run.started", {"turn": turn, "model": info.model})
            for index in range(MAX_STEPS):
                step = step_offset + index
                if run.pause.is_set():
                    await self._finish_paused(session_id)
                    return

                attempt = 0
                max_attempts = max(1, self._settings.retry_attempts)
                while True:
                    if run.pause.is_set():
                        await self._finish_paused(session_id)
                        return
                    await self._emit(
                        session_id, "step.started", {"turn": turn, "step": step}
                    )
                    try:
                        result = await self._consume(run, session_id, step, turn)
                        break
                    except _Paused:
                        await self._emit(
                            session_id, "step.discarded", {"turn": turn, "step": step}
                        )
                        await self._finish_paused(session_id)
                        return
                    except ProviderError as exc:
                        if exc.retryable and attempt + 1 < max_attempts:
                            attempt += 1
                            delay = (
                                min(30.0, max(0.0, exc.retry_after))
                                if exc.retry_after is not None
                                else min(
                                    20.0,
                                    self._settings.retry_base_seconds * (2 ** (attempt - 1)),
                                )
                            )
                            await self._emit(
                                session_id,
                                "step.discarded",
                                {"turn": turn, "step": step, "reason": "retry"},
                            )
                            await self._emit(
                                session_id,
                                "retry",
                                {
                                    "turn": turn,
                                    "step": step,
                                    "attempt": attempt,
                                    "max_attempts": max_attempts,
                                    "delay_ms": int(delay * 1000),
                                    "code": exc.code,
                                    "message": str(exc),
                                    "status": exc.status,
                                },
                            )
                            if not await self._wait_retry(run, delay):
                                await self._finish_paused(session_id)
                                return
                            continue
                        await self._emit(
                            session_id,
                            "step.discarded",
                            {"turn": turn, "step": step, "reason": "error"},
                        )
                        await self._emit(
                            session_id,
                            "error",
                            {
                                "code": exc.code,
                                "message": str(exc),
                                "retryable": exc.retryable,
                                "status": exc.status,
                            },
                        )
                        await self._set_status(session_id, "error")
                        await self._emit(
                            session_id, "run.finished", {"status": "error", "turn": turn}
                        )
                        return
                    except asyncio.CancelledError:
                        raise

                content: str = result["content"]
                reasoning: str = result["reasoning"]
                tool_calls: list[dict] = result["tool_calls"]
                usage: dict = result.get("usage") or {}

                await self._emit_usage(session_id, usage)
                raw_calls = (
                    json.dumps(tool_calls, ensure_ascii=False, separators=(",", ":"))
                    if tool_calls
                    else None
                )
                message_seq = await asyncio.to_thread(
                    store.append_message,
                    session_id,
                    turn=turn,
                    role="assistant",
                    content=content,
                    reasoning=reasoning,
                    tool_calls_raw=raw_calls,
                )
                await self._emit(
                    session_id,
                    "step.finished",
                    {
                        "turn": turn,
                        "step": step,
                        "message_seq": message_seq,
                        "content": content,
                        "reasoning": reasoning,
                        "tool_calls": tool_calls,
                        "usage": usage,
                    },
                )

                if not tool_calls:
                    await self._set_status(session_id, "idle")
                    await self._emit(
                        session_id, "run.finished", {"status": "done", "turn": turn}
                    )
                    return

                pending_images: list[dict] = []
                for call in tool_calls:
                    if run.pause.is_set():
                        break
                    outcome = await self._run_tool(run, session_id, turn, call)
                    if outcome is not None and outcome.images:
                        pending_images.extend(outcome.images)
                    if run.pause.is_set():
                        break
                # 图片观察必须排在这一组 tool 结果之后，否则 assistant(tool_calls)
                # 与 tool 消息之间会夹入 user 消息，DeepSeek 直接 400。
                if pending_images:
                    await self._append_images(session_id, turn, pending_images)
                if run.pause.is_set():
                    await self._finish_paused(session_id)
                    return
            await self._emit(
                session_id,
                "error",
                {"code": "too_many_steps", "message": "单轮工具调用过多，已停止", "retryable": True},
            )
            await self._set_status(session_id, "error")
            await self._emit(session_id, "run.finished", {"status": "error", "turn": turn})
        except asyncio.CancelledError:
            if not (run.stopping or run.pause.is_set()):
                _LOG.warning("Agent run 被取消: session=%s", session_id)
            raise
        except Exception:
            _LOG.exception("Agent run 失败: session=%s", session_id)
            try:
                await self._emit(
                    session_id,
                    "error",
                    {"code": "agent_failed", "message": "Agent 运行失败，请重试", "retryable": True},
                )
                await self._set_status(session_id, "error")
                await self._emit(session_id, "run.finished", {"status": "error", "turn": 0})
            except Exception:
                _LOG.exception("写入 Agent 错误事件失败")

    async def _finish_paused(self, session_id: int) -> None:
        info = await asyncio.to_thread(store.get_session, session_id)
        await self._set_status(session_id, "paused")
        await self._emit(
            session_id, "run.finished", {"status": "paused", "turn": info.turn}
        )

    async def _wait_retry(self, run: _Run, delay: float) -> bool:
        """等待重试；用户在这期间点暂停就返回 False。"""
        if delay <= 0:
            return not run.pause.is_set()
        try:
            await asyncio.wait_for(run.pause.wait(), timeout=delay)
            return False
        except asyncio.TimeoutError:
            return not run.pause.is_set()

    async def _emit_usage(self, session_id: int, usage: dict) -> None:
        if not usage:
            return
        info = await asyncio.to_thread(store.get_session, session_id)
        details = usage.get("completion_tokens_details") or {}
        previous = info.usage or {}
        total = int(usage.get("total_tokens") or 0)
        payload = {
            "prompt_tokens": usage.get("prompt_tokens"),
            "completion_tokens": usage.get("completion_tokens"),
            "total_tokens": usage.get("total_tokens"),
            "cache_hit_tokens": usage.get("prompt_cache_hit_tokens"),
            "cache_miss_tokens": usage.get("prompt_cache_miss_tokens"),
            # 思考 token 也计入 completion，单独记录便于核对成本
            "reasoning_tokens": details.get("reasoning_tokens"),
            # 整个会话累计的 API token（跨轮、跨 step）
            "session_total_tokens": int(previous.get("session_total_tokens") or 0) + total,
            "context_window": info.context_window,
        }
        await asyncio.to_thread(store.update_session, session_id, usage=payload)
        await self._emit(session_id, "usage", payload)

    async def _repair(self, session_id: int) -> None:
        """把上次崩溃/中断遗留的 tool_call 补成 interrupted，避免上下文不完整。"""
        pending = await asyncio.to_thread(store.pending_tool_calls, session_id)
        for call_id, name in pending:
            entry = await asyncio.to_thread(store.ledger_result, session_id, call_id)
            if entry is not None:
                status, raw = entry
                text = raw
            else:
                status = "interrupted"
                text = json.dumps(
                    failure(
                        "interrupted",
                        "上一次运行在工具执行途中中断，未产生结果，请重新调用或询问用户",
                    ).as_payload(),
                    ensure_ascii=False,
                    separators=(",", ":"),
                )
                await asyncio.to_thread(
                    store.ledger_finish,
                    session_id,
                    call_id,
                    status=status,
                    result_raw=text,
                )
            info = await asyncio.to_thread(store.get_session, session_id)
            await asyncio.to_thread(
                store.append_message,
                session_id,
                turn=info.turn,
                role="tool",
                content=text,
                tool_call_id=call_id,
                tool_name=name,
                meta={"repaired": True, "status": status},
            )

    # ------------------------------------------------------------------
    # 模型流
    # ------------------------------------------------------------------

    async def _consume(self, run: _Run, session_id: int, step: int, turn: int) -> dict:
        messages = await asyncio.to_thread(self._build_messages, session_id)
        tools = definitions()
        # 每步重新读取会话设置：用户在运行中调整 effort 时，下一步立即生效
        info = await asyncio.to_thread(store.get_session, session_id)
        consume = asyncio.create_task(
            self._consume_stream(
                run,
                session_id,
                messages,
                tools,
                info.thinking,
                info.reasoning_effort,
            ),
            name=f"filmline-agent-stream-{session_id}",
        )
        pause_wait = asyncio.create_task(run.pause.wait())
        run.stream_task = consume
        try:
            done, _ = await asyncio.wait(
                {consume, pause_wait}, return_when=asyncio.FIRST_COMPLETED
            )
            if run.pause.is_set():
                consume.cancel()
                await asyncio.gather(consume, return_exceptions=True)
                raise _Paused
            if pause_wait in done and not consume.done():
                consume.cancel()
                await asyncio.gather(consume, return_exceptions=True)
                raise _Paused
            try:
                return consume.result()
            except asyncio.CancelledError:
                if run.pause.is_set():
                    raise _Paused from None
                raise
        finally:
            pause_wait.cancel()
            await asyncio.gather(pause_wait, return_exceptions=True)
            run.stream_task = None

    async def _consume_stream(
        self,
        run: _Run,
        session_id: int,
        messages: list[dict],
        tools: list[dict],
        thinking: str,
        effort: str,
    ) -> dict:
        delta = _Delta()
        final: dict | None = None

        async def flush(force: bool = False) -> None:
            now = time.monotonic()
            if not force and now - delta.last_flush < DELTA_FLUSH_SECONDS:
                if len("".join(delta.content)) < DELTA_FLUSH_CHARS and len(
                    "".join(delta.reasoning)
                ) < DELTA_FLUSH_CHARS:
                    return
            if delta.reasoning:
                text = "".join(delta.reasoning)
                delta.reasoning.clear()
                await self._emit(session_id, "reasoning.delta", {"text": text})
            if delta.content:
                text = "".join(delta.content)
                delta.content.clear()
                await self._emit(session_id, "content.delta", {"text": text})
            delta.last_flush = now

        async for event in self._client.stream(
            messages, tools, thinking=thinking, effort=effort
        ):
            kind = event["type"]
            if kind == "reasoning":
                delta.reasoning.append(event["text"])
                await flush()
            elif kind == "content":
                delta.content.append(event["text"])
                await flush()
            elif kind == "done":
                final = event
            if run.pause.is_set():
                raise _Paused
        await flush(force=True)
        if final is None:
            raise ProviderError("模型响应为空", code="empty_response", retryable=True)
        return final

    # ------------------------------------------------------------------
    # 工具
    # ------------------------------------------------------------------

    async def _run_tool(self, run: _Run, session_id: int, turn: int, call: dict):
        call_id = str(call.get("id") or "")
        function = call.get("function") or {}
        name = str(function.get("name") or "")
        args_raw = str(function.get("arguments") or "")
        tool = get(name)
        label = tool.label if tool else name
        await self._emit(
            session_id,
            "tool.started",
            {
                "tool_call_id": call_id,
                "name": name,
                "label": label,
                "args_raw": args_raw,
                "write": bool(tool and tool.write),
                "destructive": bool(tool and tool.destructive),
                "turn": turn,
            },
        )

        run.observed_task_ids.clear()
        cached = await asyncio.to_thread(store.ledger_result, session_id, call_id)
        if cached is not None:
            status, result_raw = cached
            await self._emit(
                session_id,
                "tool.finished",
                {
                    "tool_call_id": call_id,
                    "name": name,
                    "label": label,
                    "status": status,
                    "result_raw": result_raw,
                    "cached": True,
                    "turn": turn,
                },
            )
            return None

        try:
            arguments = json.loads(args_raw) if args_raw.strip() else {}
            if not isinstance(arguments, dict):
                raise ValueError
        except ValueError:
            outcome = failure("invalid_arguments", "工具参数不是合法的 JSON 对象")
        else:
            fresh = await asyncio.to_thread(store.ledger_start, session_id, call_id, name)
            if not fresh and tool is not None and tool.write:
                # 上次执行到一半（服务重启/强制结束）：写操作不能冒险重放
                outcome = failure(
                    "interrupted",
                    "该工具上次执行状态未知，为避免重复产生副作用没有重试；请先检查结果再决定",
                )
            else:
                outcome = await self._execute_tool(
                    run, session_id, turn, call_id, name, arguments
                )

        if outcome is None:
            # 全局暂停：结果已在 _execute_tool 内写入
            return None

        payload = json.dumps(
            outcome.as_payload(), ensure_ascii=False, separators=(",", ":")
        )
        await asyncio.to_thread(
            store.append_message,
            session_id,
            turn=turn,
            role="tool",
            content=payload,
            tool_call_id=call_id,
            tool_name=name,
            meta={"status": "paused" if outcome.meta.get("paused") else "ok"},
        )
        await asyncio.to_thread(
            store.ledger_finish,
            session_id,
            call_id,
            status="paused" if outcome.meta.get("paused") else ("ok" if outcome.ok else "error"),
            result_raw=payload,
        )
        await self._emit(
            session_id,
            "tool.finished",
            {
                "tool_call_id": call_id,
                "name": name,
                "label": label,
                "status": "paused"
                if outcome.meta.get("paused")
                else ("ok" if outcome.ok else "error"),
                "summary": outcome.summary,
                "result_raw": payload,
                "preview": outcome.preview,
                "turn": turn,
            },
        )
        if run.observed_task_ids:
            # 结果已经写进上下文，完成通知不必再重复推一次
            await asyncio.to_thread(
                store.observe_tasks, session_id, list(run.observed_task_ids)
            )
            run.observed_task_ids.clear()

        return outcome

    async def _execute_tool(
        self,
        run: _Run,
        session_id: int,
        turn: int,
        call_id: str,
        name: str,
        arguments: dict,
    ):
        project = await asyncio.to_thread(self._project_of_session, session_id)
        ctx = ToolContext(
            session_id=session_id,
            project_id=project.id,
            project_code=project.code,
            project_name=project.name,
            tool_call_id=call_id,
            emit=lambda kind, data: self._emit(session_id, kind, {**data, "tool_call_id": call_id}),
            progress=self._progress(session_id, call_id),
            ask=lambda questions: self._ask(run, session_id, call_id, questions),
            pause_requested=lambda: run.pause.is_set() or call_id in run.tool_pause_ids,
            watch_task=lambda task_id: store.watch_task(session_id, task_id),
            observe_tasks=run.observed_task_ids.extend,
            runner=self._task_runner,
        )
        task = asyncio.create_task(execute(name, arguments, ctx))
        run.tool_task = task
        run.current_tool_call = call_id
        pause_wait = asyncio.create_task(run.pause.wait())
        started = time.monotonic()
        try:
            done, _ = await asyncio.wait(
                {task, pause_wait}, return_when=asyncio.FIRST_COMPLETED
            )
            if pause_wait in done and not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                if run.pause.is_set():
                    outcome = failure("paused", "用户暂停了会话，工具已中断")
                    outcome.meta["paused"] = True
                    await self._persist_paused(
                        session_id, turn, call_id, name, outcome, started
                    )
                    return None
                outcome = failure("paused", "用户暂停了这个工具")
                outcome.meta["paused"] = True
                return outcome
            return task.result()
        except asyncio.CancelledError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            if run.pause.is_set() or run.stopping:
                outcome = failure("paused", "用户暂停了会话，工具已中断")
                outcome.meta["paused"] = True
                await self._persist_paused(session_id, turn, call_id, name, outcome, started)
                return None
            outcome = failure("paused", "用户暂停了这个工具")
            outcome.meta["paused"] = True
            return outcome
        finally:
            pause_wait.cancel()
            await asyncio.gather(pause_wait, return_exceptions=True)
            run.tool_task = None
            run.current_tool_call = None

    async def _persist_paused(
        self, session_id: int, turn: int, call_id: str, name: str, outcome, started: float
    ) -> None:
        payload = json.dumps(
            outcome.as_payload(), ensure_ascii=False, separators=(",", ":")
        )
        await asyncio.to_thread(
            store.append_message,
            session_id,
            turn=turn,
            role="tool",
            content=payload,
            tool_call_id=call_id,
            tool_name=name,
            meta={"paused": True},
        )
        await asyncio.to_thread(
            store.ledger_finish, session_id, call_id, status="paused", result_raw=payload
        )
        await self._emit(
            session_id,
            "tool.finished",
            {
                "tool_call_id": call_id,
                "name": name,
                "label": name,
                "status": "paused",
                "summary": outcome.summary,
                "result_raw": payload,
                "elapsed_ms": int((time.monotonic() - started) * 1000),
                "turn": turn,
            },
        )

    def _progress(self, session_id: int, call_id: str):
        async def push(text: str, percent: int | None = None) -> None:
            await self._emit(
                session_id,
                "tool.progress",
                {"tool_call_id": call_id, "text": text, "percent": percent},
            )

        return push

    async def _ask(self, run: _Run, session_id: int, call_id: str, questions: list[dict]) -> dict:
        future: asyncio.Future = asyncio.get_running_loop().create_future()
        run.question_future = future
        run.question_call_id = call_id
        await self._set_status(session_id, "waiting_input")
        await self._emit(
            session_id, "question", {"tool_call_id": call_id, "questions": questions}
        )
        try:
            answers = await future
        finally:
            run.question_future = None
            run.question_call_id = None
        if not run.pause.is_set():
            await self._set_status(session_id, "running")
        return answers

    async def _append_images(
        self, session_id: int, turn: int, images: list[dict]
    ) -> None:
        labels = "\n".join(
            f"[图片 {index + 1}] {image.get('label') or '未命名'}"
            for index, image in enumerate(images)
        )
        text = f"以下是这一组工具读取到的图片，请结合画面继续。\n{labels}"
        await asyncio.to_thread(
            store.append_message,
            session_id,
            turn=turn,
            role="user",
            content=text,
            meta={"synthetic": "tool_images", "images": images},
        )

    # ------------------------------------------------------------------
    # 通知循环
    # ------------------------------------------------------------------

    @staticmethod
    def _project_of_session(session_id: int):
        info = store.get_session(session_id)
        return ProjectService().get(str(info.project_id))

    @staticmethod
    def _task_notice(tasks: list) -> str:
        """把同一会话所有待通知的终态任务合成一条通知，避免连续多轮重复汇报。"""
        lines = []
        for task in tasks:
            kind = {"image": "图片", "video": "视频"}.get(task.kind, "生成")
            line = f"- #{task.id} {kind}任务 {task.status}"
            if task.status == "succeeded" and task.asset_ids:
                line += "，产物资产 " + "、".join(f"#{asset_id}" for asset_id in task.asset_ids)
            elif task.status == "failed" and task.error:
                line += f"，原因：{task.error[:200]}"
            lines.append(line)
        head = (
            "系统通知：生成任务已结束："
            if len(tasks) == 1
            else f"系统通知：{len(tasks)} 个生成任务已结束（合并通知）："
        )
        return (
            f"{head}\n" + "\n".join(lines) + "\n"
            "请用 get_generation_task 核对详情和产物资产，检查是否符合预期后向用户汇报。"
            "如果某个结果你已经在之前的回复里汇报过，只需一句话确认，不要重复完整汇报；"
            "失败的任务要说明原因并给出下一步建议。"
        )

    async def _notify_loop(self) -> None:
        """任务完成通知 + 定时自检。"""
        from ..domain.tasks import TERMINAL_STATUSES, TaskService

        interval = 15
        while True:
            try:
                watches = await asyncio.to_thread(store.pending_watches)
                finished: dict[int, list] = {}
                for session_id, task_id in watches:
                    try:
                        task = await asyncio.to_thread(TaskService().get, task_id)
                    except Exception:
                        # 任务已被清理：结束关注，避免永久重试
                        await asyncio.to_thread(store.mark_watched, session_id, [task_id])
                        continue
                    if task.status in TERMINAL_STATUSES:
                        finished.setdefault(session_id, []).append(task)
                for session_id, tasks in finished.items():
                    info = await asyncio.to_thread(store.get_session, session_id)
                    if info.status not in ("idle", "error"):
                        # 正在对话中：保留未通知状态，等会话空闲后再发
                        continue
                    if not await self.notify(
                        session_id, self._task_notice(tasks), source="task"
                    ):
                        # 会话刚好又开始运行：保持待通知，下一个 tick 重试
                        continue
                    await asyncio.to_thread(
                        store.mark_watched, session_id, [task.id for task in tasks]
                    )
                if not finished:
                    await self._periodic_tick()
            except asyncio.CancelledError:
                raise
            except Exception:
                _LOG.exception("Agent 通知循环失败")
            await asyncio.sleep(interval)

    async def _periodic_tick(self) -> None:
        """每 tick_seconds 提醒一次仍在等待任务的空闲会话，让 Agent 自检。"""
        if self._settings.tick_seconds <= 0:
            return
        now = time.monotonic()
        last = getattr(self, "_last_tick", 0.0)
        if now - last < self._settings.tick_seconds:
            return
        self._last_tick = now
        session_ids = await asyncio.to_thread(store.sessions_with_pending_watch)
        for session_id in session_ids:
            info = await asyncio.to_thread(store.get_session, session_id)
            if info.status != "idle":
                continue
            await self.notify(
                session_id,
                "系统定时自检：请帮我看看之前的视频/图片创作是否已经完成，"
                "用 get_generation_task 检查正在等待的任务；如果还在运行就简短说明进度，"
                "如果已经完成就汇报结果。",
                source="timer",
            )

"""交互工具：ask_question。

调用后本轮挂起（status=waiting_input），UI 弹出对话框；用户回答作为工具结果
继续同一条推理链。用户暂停或刷新后，答案仍可通过事件与账本恢复。
"""

from __future__ import annotations

from .base import Tool, ToolContext, ToolOutcome, register


async def _ask(ctx: ToolContext, args: dict) -> ToolOutcome:
    if ctx.ask is None:
        return ToolOutcome(
            ok=False,
            summary="当前无法向用户提问",
            error={"code": "unavailable", "message": "会话未连接到交互通道"},
        )
    questions = args["questions"]
    answers = await ctx.ask(questions)
    return ToolOutcome(
        summary=f"用户已回答 {len(answers)} 个问题",
        data={"answers": answers},
    )


def register_tools() -> None:
    register(
        Tool(
            name="ask_question",
            label="询问用户",
            description=(
                "向用户提问并等待回答。适合：目标不明确、需要选择方向、删除等破坏性操作前确认。"
                "每次 1–4 个问题，每题 2–4 个选项；用户也可以自由输入。"
                "调用后本轮会挂起，直到用户回答或暂停。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "questions": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 4,
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": {"type": "string", "minLength": 1, "maxLength": 40},
                                "header": {"type": "string", "minLength": 1, "maxLength": 30},
                                "question": {"type": "string", "minLength": 1, "maxLength": 500},
                                "options": {
                                    "type": "array",
                                    "minItems": 1,
                                    "maxItems": 6,
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "label": {
                                                "type": "string",
                                                "minLength": 1,
                                                "maxLength": 80,
                                            },
                                            "description": {
                                                "type": "string",
                                                "maxLength": 200,
                                            },
                                        },
                                        "required": ["label"],
                                        "additionalProperties": False,
                                    },
                                },
                                "multiple": {"type": "boolean"},
                            },
                            "required": ["id", "header", "question", "options"],
                            "additionalProperties": False,
                        },
                    }
                },
                "required": ["questions"],
                "additionalProperties": False,
            },
            handler=_ask,
        )
    )

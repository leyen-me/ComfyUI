"""技能读取工具：系统提示只列索引，正文按需一次性加载。"""

from __future__ import annotations

from ...errors import InvalidArgument
from ..skills import get, ids
from .base import Tool, ToolContext, ToolOutcome, register


async def _read_skill(ctx: ToolContext, args: dict) -> ToolOutcome:
    skill = get(str(args["skill"]))
    if skill is None:
        available = ", ".join(ids()) or "无"
        raise InvalidArgument(f"技能不存在: {args['skill']}。可用技能: {available}")
    return ToolOutcome(
        summary=f"已读取技能「{skill.title}」（{skill.chars} 字符）",
        data={
            "skill": skill.id,
            "title": skill.title,
            "version": skill.version,
            "chars": skill.chars,
            "content": skill.text,
        },
    )


def register_tools() -> None:
    register(
        Tool(
            name="read_skill",
            label="读取技能",
            description=(
                "读取领域技能的完整正文。系统提示里只有技能索引；写视频提示词、"
                "核对格式或排查生成问题时先调用本工具加载对应技能，再动手。"
            ),
            parameters={
                "type": "object",
                "properties": {
                    "skill": {
                        "type": "string",
                        "minLength": 1,
                        "maxLength": 64,
                        "description": "技能 id，取自系统提示的技能索引",
                    },
                },
                "required": ["skill"],
                "additionalProperties": False,
            },
            handler=_read_skill,
        )
    )

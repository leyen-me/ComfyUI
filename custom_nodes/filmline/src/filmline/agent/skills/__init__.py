"""Agent 系统技能：系统提示只放索引，正文由 ``read_skill`` 工具按需加载。

每个技能是 ``skills/*.md``，文件开头必须带一个元信息块（不引入 YAML 依赖，
只支持单行 ``key: value``）：

    ---
    id: h3-prompt
    title: MiniMax H3 提示词
    summary: 一句话说明这个技能覆盖什么。
    when: 什么任务下应该加载它。
    version: 1
    ---
    正文……

约定：

* 文件名必须等于 ``id``，新增技能只需新建文件，无需改代码、无需重启；
* 目录按文件 mtime / 大小缓存，文件变化后下一次访问自动重新解析；
* 单个技能格式非法时跳过它并记入 ``problems()``，不影响其他技能与正在运行的会话；
* 系统提示里只渲染索引（id / 标题 / 覆盖内容 / 何时使用），提示长度不随技能增多而膨胀；
* 顺序按 id 排序，内容未变时返回同一个字符串，DeepSeek 前缀缓存可持续命中。
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Sequence

_LOG = logging.getLogger("filmline")

_DIR = Path(__file__).resolve().parent

_REQUIRED = ("id", "title", "summary", "when")
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_SKIP_PREFIX = ("_", "README", "readme")


@dataclass(frozen=True)
class Skill:
    """一个已解析的技能。``text`` 是去掉元信息块后的正文。"""

    id: str
    title: str
    summary: str
    when: str
    version: int
    filename: str
    text: str

    @property
    def chars(self) -> int:
        return len(self.text)


def _parse(path: Path) -> Skill:
    raw = path.read_text(encoding="utf-8")
    lines = raw.splitlines()
    if not lines or lines[0].strip() != "---":
        raise RuntimeError(f"技能 {path.name} 缺少元信息块（首行必须是 ---）")
    end = next(
        (index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"),
        None,
    )
    if end is None:
        raise RuntimeError(f"技能 {path.name} 的元信息块没有结束标记 ---")

    meta: dict[str, str] = {}
    for number, line in enumerate(lines[1:end], start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        if not sep:
            raise RuntimeError(f"技能 {path.name}:{number} 元信息必须写成 key: value")
        key, value = key.strip(), value.strip()
        if key in meta:
            raise RuntimeError(f"技能 {path.name}:{number} 元信息重复: {key}")
        meta[key] = value

    missing = [key for key in _REQUIRED if not meta.get(key)]
    if missing:
        raise RuntimeError(f"技能 {path.name} 缺少元信息: {', '.join(missing)}")

    for key in ("title", "summary", "when"):
        if any(char in meta[key] for char in '"<>'):
            raise RuntimeError(
                f"技能 {path.name} 的 {key} 不能包含双引号或尖括号（会破坏技能索引块）"
            )

    skill_id = meta["id"]
    if not _SAFE_ID.match(skill_id):
        raise RuntimeError(f"技能 {path.name} 的 id 必须是小写字母、数字或连字符: {skill_id}")
    if skill_id != path.stem:
        raise RuntimeError(f"技能 {path.name} 的 id 必须与文件名一致: {skill_id}")

    try:
        version = int(meta.get("version", "1"))
    except ValueError as exc:
        raise RuntimeError(f"技能 {path.name} 的 version 必须是整数") from exc

    text = "\n".join(lines[end + 1 :]).strip()
    if not text:
        raise RuntimeError(f"技能 {path.name} 正文为空")

    return Skill(
        id=skill_id,
        title=meta["title"],
        summary=meta["summary"],
        when=meta["when"],
        version=version,
        filename=path.name,
        text=text,
    )


class Registry:
    """按目录快照缓存的技能注册表；目录没变时返回同一个元组对象。"""

    def __init__(self, directory: Path) -> None:
        self._dir = directory
        self._lock = threading.Lock()
        self._signature: tuple[tuple[str, int, int], ...] | None = None
        self._skills: tuple[Skill, ...] = ()
        self._problems: tuple[dict[str, str], ...] = ()

    def _signature_of(self) -> tuple[tuple[str, int, int], ...]:
        found = []
        for path in sorted(self._dir.glob("*.md")):
            if path.name.startswith(_SKIP_PREFIX):
                continue
            try:
                info = path.stat()
            except OSError:
                continue
            found.append((path.name, info.st_mtime_ns, info.st_size))
        return tuple(found)

    def _load(self, signature: tuple[tuple[str, int, int], ...]) -> None:
        skills: list[Skill] = []
        problems: list[dict[str, str]] = []
        for name, _, _ in signature:
            try:
                skills.append(_parse(self._dir / name))
            except (OSError, RuntimeError) as exc:
                _LOG.error("技能加载失败，已跳过: %s", exc)
                problems.append({"file": name, "error": str(exc)})
        ids = [skill.id for skill in skills]
        if len(ids) != len(set(ids)):
            duplicated = sorted({item for item in ids if ids.count(item) > 1})
            _LOG.error("技能 id 重复，保留首个: %s", duplicated)
            seen: set[str] = set()
            unique = []
            for skill in skills:
                if skill.id in seen:
                    problems.append({"file": skill.filename, "error": f"id 重复: {skill.id}"})
                    continue
                seen.add(skill.id)
                unique.append(skill)
            skills = unique
        self._skills = tuple(sorted(skills, key=lambda skill: skill.id))
        self._problems = tuple(problems)

    def snapshot(self) -> tuple[Skill, ...]:
        signature = self._signature_of()
        if signature != self._signature:
            with self._lock:
                if signature != self._signature:
                    self._load(signature)
                    self._signature = signature
        return self._skills

    def problems(self) -> tuple[dict[str, str], ...]:
        self.snapshot()
        return self._problems


_REGISTRY = Registry(_DIR)


def snapshot() -> tuple[Skill, ...]:
    return _REGISTRY.snapshot()


def problems() -> tuple[dict[str, str], ...]:
    return _REGISTRY.problems()


def get(skill_id: str) -> Skill | None:
    return next((skill for skill in snapshot() if skill.id == skill_id), None)


def ids() -> list[str]:
    return [skill.id for skill in snapshot()]


def catalog(items: Iterable[Skill] | None = None) -> list[dict[str, object]]:
    """技能索引：既写进系统提示，也通过接口暴露给界面。"""
    skills = snapshot() if items is None else tuple(items)
    return [
        {
            "id": skill.id,
            "title": skill.title,
            "summary": skill.summary,
            "when": skill.when,
            "version": skill.version,
            "chars": skill.chars,
        }
        for skill in skills
    ]


def section(items: Sequence[Skill] | None = None) -> str:
    """渲染成系统提示里的技能索引块（只含元信息，不含正文）。"""
    skills = snapshot() if items is None else tuple(items)
    if not skills:
        return ""
    lines = [
        "<skills>",
        "下面是可用的系统技能索引，不是技能正文。任务与某个技能的“何时使用”匹配时，",
        '必须先调用 read_skill(skill="<id>") 读取完整正文，再执行或回答；',
        "不要凭记忆复述格式，也不要把技能全文原样贴给用户。",
        "可以一次加载多个技能；规则冲突时以职责更具体的那个为准，仍不确定就问用户。",
    ]
    for skill in skills:
        lines.append("")
        lines.append(
            f'<skill id="{skill.id}" title="{skill.title}" '
            f'load_with="read_skill" chars="{skill.chars}">'
        )
        lines.append(f"覆盖：{skill.summary}")
        lines.append(f"何时使用：{skill.when}")
        lines.append("</skill>")
    lines.append("</skills>")
    return "\n".join(lines)


def compose(base_prompt: str, items: Sequence[Skill] | None = None) -> str:
    """基础系统提示 + 技能索引；索引为空时只剩基础提示。"""
    base = base_prompt.strip()
    directory = section(items)
    return f"{base}\n\n{directory}" if directory else base

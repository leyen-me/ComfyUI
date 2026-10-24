"""接口 DTO（pydantic v2）。

只做“边界校验 + 输出整形”，不含业务规则；业务规则在 ``projects.py``。
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str = Field(min_length=1, max_length=120, description="项目名")
    description: str = Field(default="", max_length=2000)


class ProjectUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class ProjectOut(BaseModel):
    id: int
    code: str
    name: str
    description: str
    created_at: str
    updated_at: str


class ProjectReorder(BaseModel):
    """完整列表：必须覆盖当前全部未删除项目，避免漏传导致顺序错乱。"""

    model_config = ConfigDict(extra="forbid")

    ids: list[int] = Field(min_length=1, max_length=200)


class ProjectList(BaseModel):
    items: list[ProjectOut]
    total: int
    limit: int
    offset: int

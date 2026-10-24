"""接口 DTO（pydantic v2）。

只做“边界校验 + 输出整形”，不含业务规则；业务规则在 ``projects.py``。
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

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


class AssetKind(str, Enum):
    text = "text"
    image = "image"
    video = "video"


class AssetSource(str, Enum):
    user = "user"   # 用户创建或上传
    ai = "ai"       # ComfyUI 生成


class AssetOut(BaseModel):
    id: int
    project_id: int
    kind: AssetKind
    source: AssetSource
    name: str
    text_content: str | None = None
    mime_type: str | None = None
    size_bytes: int | None = None
    content_url: str | None = None
    meta: dict | None = None
    created_at: str
    updated_at: str


class AssetList(BaseModel):
    items: list[AssetOut]
    total: int


class AssetCounts(BaseModel):
    text: int = 0
    image: int = 0
    video: int = 0


class TextAssetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    kind: Literal["text"] = "text"
    name: str = Field(min_length=1, max_length=200)
    content: str = Field(default="", max_length=200_000)


class AssetUpdate(BaseModel):
    """改名对所有资产可用；改内容仅限文本资产。"""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    name: str | None = Field(default=None, min_length=1, max_length=200)
    text_content: str | None = Field(default=None, max_length=200_000)

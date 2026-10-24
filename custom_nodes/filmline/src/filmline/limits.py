"""提示词长度上限：生成与 AI 优化共用同一事实来源。

前端 ``prompt-assistant.ts`` 与 ``prompt-optimize-dialog.tsx`` 里的 4000 是同一约束的
展示副本；调整上限时需要同步（或在接口里下发）。
"""

from __future__ import annotations

# 提交给视频/图片模型的提示词上限
PROMPT_MAX_CHARS = 4000
# AI 优化允许的草稿长度：草稿可以比上限长，由模型压缩到上限以内
OPTIMIZE_DRAFT_MAX_CHARS = 12000

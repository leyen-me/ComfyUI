/**
 * 提示词长度不再是硬限制：生成接口不再拒绝长提示词，也没有"超过 N 字"的错误。
 * 这里只保留一个软提示，用于提醒注意力和速度，不阻止任何操作。
 * 与后端 `llm.py` 里的软建议保持一致。
 */
export const PROMPT_SOFT_HINT_CHARS = 4000

/** 一次拖入输入框的文本上限：与 AI 优化允许的草稿长度一致 */
export const TEXT_DROP_MAX_CHARS = 12000

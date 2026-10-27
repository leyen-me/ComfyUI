# 参考文档

从飞书导出的官方文档，作为提示词规则的**事实来源**保留原件。
`src/filmline/llm.py` 的 `SYSTEM_PROMPT` 与 `frontend/src/lib/prompt-assistant.ts` 的
模板 / Lint 都以这两份为准，改规则前先在这里核对原文。
Agent 的按需技能 `src/filmline/agent/skills/h3-prompt.md` 同样是这两份的摘编，
由模型通过 `read_skill` 主动加载（见 `docs/agent.md`「系统技能」）。

| 文件 | 原文 | 用途 |
|---|---|---|
| `h3-prompt-guide.html` | MiniMax H3 - 视频扩写 Prompt 写作全能指南 | 面向开发者的扩写规范：T2VA/I2VA/FL2VA/L2VA 结构、全能参考六段式、标签与保留标记、`<d>`/`<scenetrans>`/`<cutoff>` 等 |
| `h3-model-handbook.html` | MiniMax H3 模型 - 使用手册 | 面向创作者的能力与限制：素材数量与时长上限、提示词 7000 字符上限、分镜与台词节奏建议、多语种案例 |
| `src/filmline/agent/skills/h3-prompt.md` | 上面两份的摘编 | Agent 运行时规范，模型通过 `read_skill` 按需加载；系统提示只列目录 |

两份是**导出的 HTML 快照**，未做二次编辑；如需摘编规则请另建 Markdown，不要改动原件。
它们不是构建输入，只用于人工查阅。

## 已知的官方分歧（实现取舍见 README）

- 输出时长：手册写 4–15 秒，扩写指南的训练区间是 124–362 帧（≈5.2–15.1 秒）。
  当前实现取 5–15 秒。
- 独立参考音频：手册写单段 2–15 秒，当前 `generation.py` 按「不截断」处理（`max_seconds=0`）。

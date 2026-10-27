# Agent 设计说明（ADR）

状态：已实现（schema v9）。

## 背景

右侧原本是表单：模式、首尾帧/参考素材、提示词、比例、时长、任务提交分散在多个
控件里，用户必须先把意图翻译成参数。现在右侧整体替换为会话式 Agent，由模型调度
工具完成项目操作、素材读取、提示词编写与生成，表单组件保留但不再挂载。

旧的 `post /projects/{ref}/generate` 与所有 DOM 组件都没有删除，Agent 失败时
可以直接回退到原有能力。

## 关键决策

### 1. 运行在后端，浏览器只是订阅者

一次 run 是 `AgentEngine` 里的 asyncio Task。断网、刷新、换标签页都不会中断
推理或工具执行；页面重新连接时从事件序号继续。只有用户点暂停或后端进程退出
才会停止。

### 2. 事件与模型上下文分开存

| 表 | 用途 | 特点 |
|---|---|---|
| `agent_events` | SSE 增量、界面还原 | 只追加，`(session_id, seq)` 唯一 |
| `agent_messages` | 重建模型请求 | 只追加，保存原文，不规范化 |
| `agent_tool_ledger` | 工具幂等 | `tool_call_id` 唯一，崩溃后不重复执行 |
| `agent_task_watch` | 生成完成通知 | 记录哪些会话在等哪些任务 |

前端先按 `seq` 回放事件，再接实时流；`after` 参数保证断点续传。
文字增量按 120ms / 1200 字符合并写入，拼接结果与模型输出逐字符一致。

### 3. 前缀缓存优先

DeepSeek 的上下文缓存要求前缀完全稳定。因此：

- 系统提示是纯静态文本，不含时间、会话 id、随机数；
- 项目现状一律通过 `get_workspace_context` 读取，不写进 system；
- 历史消息只追加，绝不重写；编辑标题、状态、用量只改 session 表；
- `tool_calls[].function.arguments` 以模型输出的**原始字符串**保存和回填，
  不重新 `json.dumps`；
- 工具结果保存“实际发给模型的那段 JSON 文本”；
- 开启 `tools` 时按官方要求回传 `reasoning_content`（所有历史 assistant 消息）。

### 4. 暂停语义

- 全局暂停：置位 pause 事件，取消当前模型 HTTP 流与当前工具任务。
  - 流式阶段被打断：`step.discarded`，不写入半截 assistant 消息，恢复后重新请求；
  - 工具阶段被打断：写入 `{"ok":false,"error":{"code":"paused"}}` 的工具结果，
    恢复后模型能看到工具被暂停，自行决定重试或换方案。
- 单个工具暂停：只取消该工具，写入 paused 结果，run 继续，模型可立即补救。

### 5. 会话级思考强度

- `agent_sessions.thinking`：`auto | enabled | disabled`；
- `agent_sessions.reasoning_effort`：`low | high | max`（接口也接受官方映射表中的其它值）；
- 输入框右下角提供 `默认 / 低 / 高 / 最高 / 关闭`，PATCH 会话即时保存；
- 引擎每一步模型请求前重新读取会话设置，因此运行中切换 effort 会从下一步生效；
- 新建会话可通过 `POST .../agent/sessions` 的 `thinking` / `reasoning_effort` 指定，
  不传则继承全局 `FILMLINE_AGENT_*`；
- `auto` 不发送 `thinking` 字段；`enabled` 才发送 `reasoning_effort`；`disabled` 不发送 effort。

### 6. ask_question 的交互

- 面板固定在输入框上方，**非模态**：不用 `<dialog>`、不加遮罩，左侧素材与中间资产面板
  仍然可操作；用户可以先看素材、把素材拖进输入框，再回答问题。
- 面板可收起成一条“待回答”提示，展开后保留选项与自由输入。
- 问题本身是 `question` 事件，随会话 `seq` 入库。刷新浏览器/断线重连会回放事件，
  未回答的问题会再次出现（选项不会丢，但未提交的本地选择不保留）。
- 后端进程重启会把 `waiting_input` 标成 `interrupted`；点“继续”时该工具调用会被补成
  `interrupted` 结果，模型通常会重新提问，不会假装用户已经回答。

### 7. 切换会话

- 切换只影响浏览器侧：旧 SSE 取消订阅，新会话从 0 回放事件；后端 run 不受影响；
- 每个会话单独保存输入框草稿与附件，切换时保存旧草稿、恢复新草稿，避免发错会话；
- 工具详情弹窗、问题面板随会话切换关闭/重建，不会把 A 的问题显示在 B 上；
- 切换回正在运行的会话时，从已有事件继续，状态以服务端快照为准；
- 删除当前会话时，草稿一并清理。

### 8. 异步生成与通知

`create_image` / `create_video` 只提交任务并立即返回 `task_id`，同时写入
`agent_task_watch`。模型可以：

- 调用 `wait_generation` 阻塞等待并推送进度（最长 15 分钟，可被暂停打断）；
- 直接结束本轮，任务完成时由后端以“用户消息”的形式发一条专业通知并自动继续。

另外每 `FILMLINE_AGENT_TICK_SECONDS`（默认 300 秒）对仍有未完成任务的空闲会话
发一次自检通知，避免长时间无声。

### 9. 崩溃恢复

- 启动时把 `running` / `waiting_input` 会话标记为 `interrupted`；
- 恢复时补齐缺失的 tool 结果：有账本用账本，否则写入 `interrupted` 错误；
- 已完成的工具不会重复执行（尤其生成任务）；
- 生成任务本身由已有的 `generation_tasks` runner 恢复，与 Agent 解耦。

## 事件协议

SSE：`id: <seq>`，`data: {"seq","type","data","ts"}`，心跳为 `: ping`。

| type | 关键字段 | 用途 |
|---|---|---|
| `user.message` | `turn,text,content,assets,message_seq` | 用户消息 |
| `notice` | `turn,text,source` | 系统代替用户发送的通知 |
| `session.status` | `status` | idle / running / waiting_input / paused / interrupted / error |
| `run.started` | `turn,model` | 本轮开始 |
| `step.started` | `turn,step` | 一次模型请求 |
| `reasoning.delta` | `text` | 深度思考增量（原文） |
| `content.delta` | `text` | 正文增量（原文） |
| `step.finished` | `content,reasoning,tool_calls,usage,message_seq` | 一次模型请求的权威结果 |
| `step.discarded` | `turn,step` | 暂停导致该步作废 |
| `tool.started` | `tool_call_id,name,label,args_raw,write,destructive` | 工具开始 |
| `tool.progress` | `text,percent` | 工具进度 |
| `tool.finished` | `status,result_raw,summary,elapsed_ms` | 工具结束（ok/error/paused） |
| `question` | `tool_call_id,questions` | ask_question 内联面板 |
| `question.answered` | `tool_call_id,answers` | 用户回答 |
| `usage` | `prompt_tokens,completion_tokens,cache_hit_tokens,context_window` | 上下文占用 |
| `error` | `code,message,retryable` | 运行错误 |
| `asset.watch` | `task_id,kind,status` | 提交了生成任务 |

## 工具

| 分组 | 工具 |
|---|---|
| 工作区 | `get_workspace_context` `list_episodes` `create_episode` `update_episode` `delete_episode` `create_project` `update_project` |
| 资产 | `list_assets` `get_asset` `read_text_asset` `create_text_asset` `update_text_asset` `delete_asset` |
| 媒体 | `probe_media` `read_image` `read_video`（抽帧拼图） `read_audio` `extract_frame` |
| 生成 | `create_image` `create_video` `get_generation_task` `list_generation_tasks` `wait_generation` `cancel_generation_task` |
| 外部 | `web_search` `web_fetch`（DeepSeek Search / Fetch，按次计费） |
| 交互 | `ask_question` |

统一输入校验：JSON Schema 子集，`additionalProperties=false`。
统一输出：`{ok, summary, data, error, meta}`，失败不抛给模型。
删除/取消类操作必须 `ask_question` 确认后带 `confirmed=true`。

`web_search` / `web_fetch` 使用与模型相同的 API Key 和 Base URL，请求
`/v1/tools/search`、`/v1/tools/fetch`（base 已带 `/v1` 时自动去重）。搜索
`count` 限制 1–20，`need_content` 时每条正文最多 4000 字符、总量 20000 字符；
抓取正文最多 20000 字符，超出截断。网页内容标记为不可信外部数据，系统提示禁止
执行网页中的指令；工具返回 `meta.untrusted=true`。这两个接口按成功请求计费，
并且不是所有 OpenAI 兼容 provider 都提供，切换 provider 后需要确认端点可用。

图片类工具会把 data URL 作为额外的 user 消息追加到模型上下文（模型无法从工具
文本里“看到”图片）；这是唯一会向历史追加内容的位置，且只在工具调用后发生。
必须等同一批 `tool_calls` 的所有 tool 结果都写完后，再追加这条 user 消息：
DeepSeek 要求 assistant 的 `tool_calls` 后紧跟对应的全部 tool 消息，中间夹 user
消息会直接返回 400。`_build_messages` 还会对旧历史做一次顺序归一化，修复早期
版本留下的“tool 结果与图片观察交错”的消息。

## HTTP 接口

| 方法 | 路径 |
|---|---|
| GET | `/studio/api/agent/system-prompt` |
| GET | `/studio/api/projects/{ref}/agent/sessions` |
| POST | `/studio/api/projects/{ref}/agent/sessions` |
| GET/PATCH/DELETE | `/studio/api/agent/sessions/{id}` |
| GET | `/studio/api/agent/sessions/{id}/events?after=N`（SSE） |
| POST | `/studio/api/agent/sessions/{id}/messages` |
| POST | `/studio/api/agent/sessions/{id}/pause` |
| POST | `/studio/api/agent/sessions/{id}/resume` |
| POST | `/studio/api/agent/sessions/{id}/answers` |
| POST | `/studio/api/agent/sessions/{id}/tools/{tool_call_id}/pause` |

会话按项目归属、所有人共享；与分集无关。所有写操作仍走原有领域服务与校验，
生成参数校验收敛在 `domain/produce.py`，HTTP 与工具共用，不存在第二套规则。

## 系统提示可见

`GET /studio/api/agent/system-prompt` 直接返回 `agent/prompt.py::SYSTEM_PROMPT`
原文、字符数、sha256、模型与思考模式、工具目录。前端在会话顶部固定一条可折叠
的「系统提示」，默认显示预览，展开后逐字展示 prompt 并支持复制。

它展示的是**每次请求实际发送的系统提示**。工具定义（`tools` 数组）、历史消息和
项目数据不在其中：工具定义随请求单独发送，项目现状由模型通过工具读取。因此
不能把这条提示误当成“完整请求”。

提示文本是代码常量，改动需要发布新版本；sha256 用于让用户核对当前运行的版本。

## 配置

| 变量 | 默认 | 说明 |
|---|---|---|
| `FILMLINE_AGENT_API_KEY` / `DEEPSEEK_API_KEY` | 空 | 未配置时 Agent 不可用 |
| `FILMLINE_AGENT_BASE_URL` / `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | OpenAI 兼容端点 |
| `FILMLINE_AGENT_MODEL` / `DEEPSEEK_MODEL` | `deepseek-flash` | 模型 |
| `FILMLINE_AGENT_THINKING` / `DEEPSEEK_THINKING` | `auto` | `auto` 不发送 thinking（DeepSeek 默认开启，兼容其它 provider）；`enabled` / `disabled` 显式发送 |
| `FILMLINE_AGENT_REASONING_EFFORT` | `high` | 仅 `enabled` 时发送；low / high / max，非法值回落 high |
| `FILMLINE_AGENT_CONTEXT_WINDOW` | `1000000` | 上下文占用分母 |
| `FILMLINE_AGENT_MAX_TOKENS` | `8192` | 单次输出预算（含思考） |
| `FILMLINE_AGENT_TIMEOUT` | `300` | 流式读取空闲超时（秒） |
| `FILMLINE_AGENT_TICK_SECONDS` | `300` | 定时自检间隔 |

## 已知限制

- 上下文接近窗口时不会自动摘要；目前只显示占用，不做压缩（压缩会破坏前缀缓存）。
- 工具图片的 data URL 会写入消息表，长时间会话会增大数据库；后续可按资产 id
  延迟重建。
- 定时自检只在仍有未完成任务时触发，且同一会话最多每 5 分钟一次。
- 没有鉴权：会话与生成任务一样，按现有内网单机模式所有人共享。

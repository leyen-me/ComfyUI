# Filmline

影视制片管线，以 ComfyUI 扩展的形式运行，**不修改 ComfyUI 任何源码**，
只通过官方扩展点注册 HTTP 路由。

当前进度：P0 项目 / 分集 / 资产 / 生成管线已完成；右侧生成面板已替换为
**会话式 Agent**（可调用项目、资产、媒体与生成工具），旧表单组件保留但不再挂载。

## 为什么不做成独立服务

内网单机、少数几个人用，同源可以直接用 ComfyUI 的 `/ws`、`/view`、`/prompt`，
省掉反向代理、WebSocket 转发、跨域和鉴权的一整套成本。等真要多人/多机时，
`src/filmline/` 可以整体平移成独立进程，`domain/` 与 `api/` 已经解耦。

## 运行

后端只用 ComfyUI 自带的 aiohttp / SQLAlchemy / pydantic，无需安装依赖；
**改了 Python 代码要重启 ComfyUI**。前端是构建产物，改了源码要重新 build。

- 前端：<http://127.0.0.1:8188/studio>
- 健康检查：<http://127.0.0.1:8188/studio/api/health>

## 前端

React 19 + Vite 7 + TypeScript + Tailwind CSS v4，组件按 shadcn/ui 的写法手写
（`cva` + `cn` + CSS 变量），不依赖 Radix 等运行时库；模态框用原生 `<dialog>`。

- **默认深色**：`<html class="dark">`，首屏前用内联脚本读 `localStorage`，无闪烁；
  顶栏可切换浅色，偏好持久化。
- **路由**：`/studio` 项目列表，`/studio/projects/{编号}` 项目详情。后端对
  `/studio/*` 做 SPA 回落（`/studio/api/*`、`/studio/static/*` 除外）。
- **全局顶栏**：56px 统一顶栏（品牌 / 面包屑 / 主题切换），右上角预留任务队列按钮。
- **项目列表**：卡片墙，封面取项目最新一张图片，无图时按 id 生成稳定的渐变占位。
- **项目内布局**：左侧项目导航（项目资产 + 分集列表），中间资产面板
  （分类用分段控件：文本 / 图片 / 视频 / 音频），右侧是 **Agent 会话**：
  顶部切换会话、中间流式消息、底部输入框；左侧资产可直接拖入输入框作为附件。
- **Agent 界面**：每个 turn 的深度思考、中间输出与工具调用收进可折叠区域，
  最终回答在折叠之外；思考为浅色斜体，正文正常色，工具为蓝色下划线，点击查看
  输入/输出并可分别复制；工具执行时显示转圈与进度，单个工具可暂停；输入框右下角
  在运行中变为暂停按钮；顶部显示上下文占用（如 `31.5K/1M（3%）`）。
- **资产来源标记**：`source=user`（用户创建或上传）与 `source=ai`（ComfyUI 生成），
  界面上以徽章区分。文本资产由用户创建；图片/视频支持上传并指定来源。
- **拖拽排序**：HTML5 原生拖拽，松手即保存；菜单里另有「上移/下移」作为键盘替代。
- **品牌名收敛**：展示名只在 `frontend/src/lib/brand.ts`（以及 `index.html` 的 `<title>`）。
- **构建产物**：输出到 `../web/`，由 ComfyUI 以 `/studio/static/` 提供，**不要手改**。

```bash
cd custom_nodes/filmline/frontend

npm install          # 首次
npm run dev          # 开发：http://localhost:5173 ，/studio/api 代理到 8188
npm run typecheck    # tsc --noEmit
npm run build        # 类型检查 + 构建到 ../web
npm run smoke        # jsdom 里真实执行产物，拦白屏
npm run test:logic   # 纯函数单测（页码、提示词、拖拽载荷等）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/studio/api/projects` | 列表，支持 `q` / `limit` / `offset`，按手动排序返回；每项附 `cover_asset_id`（最新图片）与 `asset_count` |
| POST | `/studio/api/projects` | 新建，`{name, description?}`，编号由系统生成，排在最前 |
| PUT | `/studio/api/projects/order` | 拖拽排序，`{ids: [...]}` 必须覆盖全部项目 |
| GET | `/studio/api/projects/{ref}` | 详情，`ref` 可为数字 id 或项目编号 |
| PATCH | `/studio/api/projects/{ref}` | 更新 `name` / `description` |
| DELETE | `/studio/api/projects/{ref}` | 软删除，返回 204 |
| GET | `/studio/api/projects/{ref}/episodes` | 分集列表 |
| POST | `/studio/api/projects/{ref}/episodes` | 新建分集（自动 EP01 / 第 N 集） |
| PUT | `/studio/api/projects/{ref}/episodes/order` | 分集排序（需覆盖全部） |
| GET | `/studio/api/projects/{ref}/episodes/{code}` | 按编号查分集 |
| PATCH / DELETE | `/studio/api/episodes/{id}` | 改名/改简介、软删除 |
| GET | `/studio/api/projects/{ref}/assets` | 资产列表，`kind=text\|image\|video\|audio`、`source=user\|ai`，`episode=EP01` 限定分集 |
| GET | `/studio/api/projects/{ref}/assets/counts` | 各分类数量（同样支持 `episode`） |
| POST | `/studio/api/projects/{ref}/assets` | 新建文本资产 `{name, content?}` |
| POST | `/studio/api/projects/{ref}/assets/upload` | 上传图片/视频/音频，`?source=user\|ai&episode=EP01` |
| PATCH | `/studio/api/assets/{id}` | 改名（全部）与改正文（仅文本） |
| GET | `/studio/api/assets/{id}/content` | 资产文件内容 |
| GET | `/studio/api/assets/{id}/media-info` | 视频/音频时长、帧率、音轨与采样信息 |
| DELETE | `/studio/api/assets/{id}` | 软删除资产 |
| GET | `/studio/api/tasks` | 生成任务列表（合并 ComfyUI 外部队列），`?active=1&limit=30` |
| GET | `/studio/api/tasks/{id}` | 单个任务状态；前端提交后轮询 |
| POST | `/studio/api/tasks/{id}/cancel` | 取消排队/运行中的 Filmline 任务 |
| POST | `/studio/api/prompts/optimize` | DeepSeek 提示词优化（仅视频，后端代理） |
| GET | `/studio/api/agent/system-prompt` | 原样返回系统提示、sha256、模型、思考模式与工具目录 |
| GET | `/studio/api/agent/balance` | DeepSeek 余额代理，`?force=1` 跳过 3 秒缓存 |
| GET | `/studio/api/projects/{ref}/agent/sessions` | 项目的 Agent 会话列表（含模型与上下文窗口） |
| POST | `/studio/api/projects/{ref}/agent/sessions` | 新建会话 |
| GET/PATCH/DELETE | `/studio/api/agent/sessions/{id}` | 会话详情 / 改名 / 修改思考强度 / 软删除 |
| GET | `/studio/api/agent/sessions/{id}/events?after=N` | SSE 事件流，`after` 断点续传 |
| POST | `/studio/api/agent/sessions/{id}/messages` | 发送消息（`text` + `asset_ids`），202 启动运行 |
| POST | `/studio/api/agent/sessions/{id}/pause` | 暂停推理与当前工具 |
| POST | `/studio/api/agent/sessions/{id}/resume` | 继续被暂停/中断的会话 |
| POST | `/studio/api/agent/sessions/{id}/answers` | 回答 `ask_question` |
| POST | `/studio/api/agent/sessions/{id}/tools/{tool_call_id}/pause` | 只暂停某个工具 |
| GET | `/studio/api/health` | 版本、库路径、schema 版本、项目数、LLM 是否配置 |

统一响应信封：

```json
{"ok": true,  "data": {...}, "ts": "2026-10-24T07:40:03.123Z"}
{"ok": false, "error": {"code": "invalid_argument", "message": "参数校验失败", "details": [...]}, "ts": "..."}
```

错误码：`invalid_argument` (400)、`not_found` (404)、`conflict` (409)、`internal_error` (500)。

## 数据位置

```
ComfyUI/user/filmline/
├── filmline.db                       # 元数据
├── assets/{project_id}/project/      # 项目级资产文件
├── assets/{project_id}/EP01/         # 分集资产文件
└── tmp/                              # 上传中转，成功后移入 assets
```

可用环境变量覆盖：

| 变量 | 作用 |
|---|---|
| `FILMLINE_DATA_DIR` | 数据根目录（未来放缩略图、导出文件） |
| `FILMLINE_DB_PATH` | 直接指定数据库文件 |
| `FILMLINE_REF_UNET` | Ref2VA UNet 文件名（默认 int8_convrot；显存不足可回退 fp8） |
| `FILMLINE_REF_SHORT_EDGE` | 参考视频解码短边（默认 768；显存不足可设 512） |
| `FILMLINE_REF_SCHEDULER` | 参考生成默认调度器（simple / beta / normal） |
| `FILMLINE_COMFY_URL` | 本机 ComfyUI 地址 |
| `FILMLINE_VIDEO_TIMEOUT` | 视频任务超时秒数（默认 7200，即 2 小时） |
| `FILMLINE_AGENT_API_KEY` | Agent 模型 Key，未设置时回落到 `DEEPSEEK_API_KEY` |
| `FILMLINE_AGENT_BASE_URL` | OpenAI 兼容端点，默认 `https://api.deepseek.com` |
| `FILMLINE_AGENT_MODEL` | 模型，默认 `deepseek-flash` |
| `FILMLINE_AGENT_THINKING` | `auto`（默认，不发送 `thinking`，DeepSeek 默认开启）/ `enabled` / `disabled` |
| `FILMLINE_AGENT_REASONING_EFFORT` | 仅 `enabled` 时发送；`low` / `high` / `max`，非法值回落 `high` |
| `FILMLINE_AGENT_CONTEXT_WINDOW` | 上下文窗口，默认 `1000000` |
| `FILMLINE_AGENT_MAX_TOKENS` | 单次输出预算（含思考），默认 `8192` |
| `FILMLINE_AGENT_TIMEOUT` | 流式读取空闲超时秒数，默认 `300` |
| `FILMLINE_AGENT_TICK_SECONDS` | 未完成任务的定时自检间隔，默认 `300` |
| `FILMLINE_AGENT_IMAGE_MODE` | `auto`（优先 Files API）/ `inline` / `files`，默认 `auto` |
| `FILMLINE_AGENT_FILE_EXPIRY_DAYS` | Files API 文件有效期，1–30 天，默认 `30` |
| `FILMLINE_AGENT_RETRY_ATTEMPTS` | 模型请求总尝试次数（含首次），1–6，默认 `3` |
| `FILMLINE_AGENT_RETRY_BASE_SECONDS` | 指数退避基数秒数，默认 `2` |

## 视频生成参数（对齐官方）

| 项 | 取值 | 依据 |
|---|---|---|
| 分辨率 | `768` 原生档（1344×768 / 768×1344 / 992×992）+ `0.4` 草稿档（864×480 / 480×864 / 640×640） | 对齐官方 ResolutionSelector；768 为原生 0.98MP |
| 时长 | 5–15 秒（预设 5/8/10/12/15，自定义整数秒；接口接受浮点） | 模型训练区间 124–362 帧（≈5.2–15.1 秒）；24fps，帧数向上对齐 17k+5 |
| 采样 | `res_multistep` + `simple`，4 步（首尾帧） | 官方模板 SamplerCustomAdvanced |
| cfg | 1.0（等价 BasicGuider） | 权重为 CFG 蒸馏 |
| LoRA | `minimax_h3_fl2v_turbo_4step_v1.0_768p` | 与本地已有权重匹配 |
| 提示词 | 建议包含镜头、运镜与声音（对白/音效/配乐） | 该模型联合生成音视频 |

> Ref2VA 的采样参数单独一套，见下方「参考生成」。默认走官方基线：20 步、不挂 turbo LoRA。

### 视频生成方式

视频面板下分两种条件输入方式，分别对应 H3 的两套权重：

- **首尾帧**（`fl2va`）：上方两个独立槽位，可拖入或点击选择图片；两个都留空为文生视频，
  只填一个即首帧或尾帧生视频。图片会按输出比例居中裁切，比例不一致时槽位下方会提示。
  把视频拖进槽位会打开选帧对话框，截取任意一帧保存为图片资产后作为首/尾帧，用于连续镜头。
  连贯镜头的常用做法：把上一段视频拖到首帧槽位，点「末帧」，用这一帧作为下一段的首帧。
  请求字段：`mode=keyframes`、`first_frame_id`、`last_frame_id`。
- **参考生成**（`ref2va`）：图片 ≤9、视频 ≤3、独立音频 ≤3，所有文件合计 ≤12；
  参考视频每段裁剪后 2–15 秒、总时长 ≤15 秒；参考音频每段 ≥2 秒、不设上限。顺序决定提示词里的
  `<Picture i>`、`<Video k>`、`<Audio j>`；参考素材不会锁定第 0 帧。请求字段：
  `mode=reference`、`refs=[图片 id]`、`ref_videos=[{asset_id, use_audio, trim_start, trim_end}]`、
  `ref_audios=[音频 id]`、`ref_guides=[{asset_id, at_seconds}]`。
  参考视频会裁剪到所选区间、重采样到 24fps、短边压到 768（官方 Ref2VA 画布），
  帧数按 17k+5 向下对齐；视频原声占用一个 `<Audio j>`，独立音频排在所有原声之后。

#### 参考生成的画质与时长

| 项 | 取值 | 说明 |
|---|---|---|
| 画质档 | `quality`（默认，20 步、不挂 LoRA）/ `fast`（8 步 + turbo LoRA 0.7） | 参考 token 参与每一步采样，步数过低会身份/口型漂移 |
| UNet | `minimax_h3_ref2va_pruned_int8_convrot` | 官方模型卡：能用 int8_convrot 就优先用；可用 `FILMLINE_REF_UNET` 回退 fp8 |
| 调度器 | `simple`（默认）/ `beta` / `normal` | 官方模板注：参考重的提示词 beta/normal 往往更好 |
| 参考图尺寸 | `match`（默认，缩到生成像素面积）/ `max`（2048 短边，身份更准但更慢） | 对应官方 `ref_image_size` |
| 自动时长 | `auto_duration=true` | 取最长的一段有效参考音频（含视频原声）作为输出时长，5–15 秒内收敛 |
| 固定种子 | `seed`（0–2147483647） | 面板「参考设置」可勾选，便于 A/B 复现 |
| 帧锚定 | `ref_guides`，最多 4 个 | 官方 `MiniMaxH3AddGuide`：把参考图钉到输出时间轴的具体秒数，可链式叠加 |
| 参考视频裁剪 | `trim_start` / `trim_end`（出点 0 = 到结尾） | 卡片剪刀按钮打开裁剪对话框：一个双柄区间滑块选入/出点，播放从入点开始并在区间内循环，区间需 2–15 秒 |

音频进入采样前会校验：采样率 ≤384kHz、无 NaN/无穷值、非静音；单声道复制为双声道，
多声道保留前两轨。静音音频会直接失败，而不是静默失去参考效果。
「只有独立音频、没有图片/视频」会被拒绝——缺少视觉锚点时 Ref2VA 基本不生效。

生成结果 `meta` 会记录 `video_mode`（`keyframes` / `reference`）、
`first_frame_id` / `last_frame_id`（首尾帧）、`ref_ids` / `ref_video_ids` /
`ref_video_use_audio` / `ref_video_trims` / `ref_audio_ids` / `ref_guide_ids` /
`ref_guide_frames` / `ref_quality` / `ref_scheduler` / `ref_image_size` /
`auto_duration`（参考生成），供前端还原；旧视频资产只有 `ref_ids`
时按首帧兼容。`keyframes` 模式的 `ref_ids` 存首尾帧 id，`reference` 模式的 `ref_ids`
只存参考图 id。

时长在面板下方选择：预设 5/8/10/12/15 秒，也可以输入 5–15 之间的整数秒。提交前会按
24fps、17k+5 网格向上对齐（例如 13 秒 → 328 帧 ≈ 13.7 秒），面板里会显示实际帧数与时长。
超出 5–15 秒由接口直接拒绝。

### 资产拖拽

- 图片：拖到提示词输入框变成「图 N」引用块；视频模式请拖到上方首/尾帧槽位。
- 视频/音频：拖到首/尾帧槽位或参考素材区；拖进提示词输入框会提示正确落点。
- 文本：拖到右侧提示词输入框，正文直接变成文字（保留空行）；单次最多插入 12000 字符，
  超出会提示并按上限截断，避免超长文本把编辑器拖垮。文本卡片单击条目即进入编辑。

### 提示词结构助手

- 生成面板提示词上方可展开「提示词助手」，在宽屏上位于消息框右侧。
- 按当前模式给出结构片段：图片模式是主体/构图/环境/风格/约束；首尾帧是首帧对齐、画面、动作、对白、环境声、配乐、禁止项；参考生成是官方六段式。
- 提供 `<d>[Chinese] ...</d>`、`(S1)`、`<Picture N>` / `<Video N>` / `<Audio N>`、无字幕、运镜、环境声等快速插入。
  「不要字幕」片段只在首尾帧/文生视频模式提供——参考模式是六段式，末尾追加会变成第七段。
- 首尾帧对齐句由 `alignmentInstruction(keyframes, duration)` 生成，时长取**帧对齐后的真实秒数**
  并固定两位小数（例如 5 秒 → `5.17-second mark`），不再硬编码 5.00；
  后端 `llm.alignment_instruction()` 用同一套规则，保证模板与 AI 优化一致。
- 内置确定性 Lint（只提示，不阻断、不改写）：
  - 通用：裸引号对白、缺少说话人、缺少“无字幕”、误用 `图1` / `<imageN>`、超长
    （>4000 字符软提示，>7000 字符提示已超官方上限）。
  - 镜头：逐秒列表（`00:01.0 — ...`）、`[Shot N]` 缺失、「一镜到底」却又写 `[Shot 2]+`、
    首尾帧双图却没写 no cut。
  - 参考模式：缺六段、缺任务类型方括号、`retention_analysis` 行格式不符、
    `detailed_description` 不点名 `<Subject N>` / `<Picture N>`、末尾多出禁止字幕段、
    `<scenetrans>` 未成对。
  - 对白：按中文 4.5 字/秒、英文 2.7 词/秒估算台词时长，超过镜头时长会提示口型风险。
- 结构插入和 Lint 都是确定性的，不会自动改写或提交；AI 优化需显式点击并预览确认。

### AI 提示词优化（DeepSeek，可选）

- `提示词助手` 里的「AI 优化提示词」会把当前视频提示词、参考标签和首尾帧状态发给后端，
  由后端代理调用 DeepSeek；前端永远不接触 API Key。
- 目前只支持视频提示词；图片模式因为含图片块，不做自动替换。
- 输出先在对比弹窗里预览（原文 / 优化后可编辑），用户点「应用并替换」才写入输入框，不会自动提交。
- 环境变量（也可写入运行环境或 `.env`，参考 `.env.example`）：

```env
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_TIMEOUT=45
# 输出预算：推理模型的思考 token 也计入，2048 以下容易截断 JSON
DEEPSEEK_MAX_TOKENS=4096
```

- 不配置 `DEEPSEEK_API_KEY` 时接口返回 503，按钮会显示不可用提示，不影响普通生成。
- 会附带当前首尾帧或参考图片（最多 4 张）给 DeepSeek，让它理解画面里谁在说话、嘴/喙是否张开、构图和背景。
- 参考视频会额外抽取 2–3 帧（单段 3 帧、多段各 2 帧，总帧数 ≤6），以带时间戳的标签（如 `<Video 1> @ 2.5s`）一并发送，让 AI 看到视频里的真实动作、方向和运镜；**不会上传完整视频/音频文件**。
- 图片由后端按资产 id 读取并转 data URL，前端只传 id 和标签；发送前会限制单张/总大小。
- 发送给 DeepSeek 的还有提示词文本和参考标签（`<Picture 1>` 等）。
- 长度策略：生成接口不会因为"太长"拒绝，但 H3 官方提示词上限是 **7000 字符**。
  超过 4000 字符给软提示（可能稀释注意力、增加编码耗时），超过 7000 字符提示已超官方上限。
  请求体本身仍有 256KB 上限，属于防误贴的安全边界。
- 规范策略：系统提示按官方两份文档（扩写指南 + 使用手册）收敛，重点约束：
  参考模式只有六段、`summary` 必须有方括号任务类型、`detailed_description` 用镜头散文
  （禁止逐秒列表）、`retention_analysis` 固定行格式（不写 `(Sx)`）、帧锚点用官方三句式、
  首尾帧对齐句由后端确定性生成、`<scenetrans>` / `<cutoff>` 用法、台词长度按镜头时长规划、
  特征只描述参考素材中真实可见的内容。
- 已知官方文档分歧（暂按代码实现保留，待实测）：
  - 输出时长：使用手册写 4–15 秒，扩写指南的训练区间是 124–362 帧（≈5.2–15.1 秒），
    当前实现取 5–15 秒。
  - 独立参考音频：使用手册写单段 2–15 秒，`generation.py` 按「不截断」处理（`length=0`）。
- 格式策略：思考 token 计入 `max_tokens`，预算不足会把 JSON 截断；默认 4096，
  并在截断/非法 JSON 时自动重试一次（重试预算翻倍），仍失败才返回明确错误。
- 失败、超时、返回格式异常都会保留原文，不阻塞生成；应用前可人工修改。

### Agent（右侧会话）

右侧不再是表单，而是一个后端常驻的会话式 Agent。完整设计见
[`docs/agent.md`](docs/agent.md)。

- **余额**：右上角显示 DeepSeek 账户余额（原「新建对话」加号的位置，新建对话移到
  会话下拉菜单）。后端代理官方 `GET /user/balance`，API Key 不下发；页面加载时拉一次，
  每轮 `run.finished` 后再刷新，数值变化带数字滚动动画。点击余额可查看赠金/充值明细并手动刷新。
- **系统提示可见**：右侧顶部固定一条「系统提示」，收起时显示原文预览与字符数，
  展开后原样展示每次请求实际发送的 prompt，并附模型、思考模式、工具数量与
  sha256；可一键复制。工具定义、历史消息和项目数据不在系统提示里，界面会注明。
- **会话归属与切换**：一个项目可有多个对话，顶部切换，与分集无关；所有人共享。
  每个会话独立保存输入草稿和附件；切换时断开旧 SSE 并回放新会话历史，工具详情自动关闭，
  未回答的问题面板只属于原会话。切换不会中断后端正在运行的会话，切回来会从当前进度继续。
- **流式**：后端把模型输出拆成 reasoning / content / tool 事件，按 `seq` 入库；
  浏览器用 SSE 从 `after` 断点续传。断网、刷新、换标签页都不会中断推理；
  重新打开页面会先回放历史再继续接收。
- **暂停**：全局暂停会中断模型请求与正在执行的工具，工具会得到
  `{"ok":false,"error":{"code":"paused"}}`；流式阶段的半截消息作废，恢复后重新请求。
  单个工具也可以在消息流里点暂停。
- **自动重试**：模型请求遇到 `408 / 429 / 5xx / 网络错误 / 超时` 会自动重试，默认总尝试
  3 次，指数退避（2s、4s，上限 20s），优先遵守 `Retry-After`。每次重试会先作废半截
  step，不会把重复内容写进上下文；重试期间点暂停会立即停止。`400 / 401 / 402 / 413 / 422`
  不重试。工具里 `web_search` / `web_fetch` 也有一次显式重试；写工具不会自动重放，避免副作用。
- **Token 记录**：每次响应记录 `prompt_tokens`、`completion_tokens`、`total_tokens`、
  缓存命中/未命中、`reasoning_tokens` 和会话累计 token；上下文占用显示使用
  `total_tokens / context_window`。图片 token 由官方按尺寸折算并包含在 `usage` 里，
  我们不做二次计算；搜索/抓取按请求计费，不计 token。
- **恢复**：进程重启后未完成的会话标记为 `interrupted`；缺失的工具结果由账本或
  `interrupted` 错误补齐，已执行的工具不会重复执行。
- **会话级思考强度**：输入框右下角可选择 `默认 / 低 / 高 / 最高 / 关闭`，只影响当前会话。
  选择 `低/高/最高` 会显式发送 `thinking=enabled` 与 `reasoning_effort`；`默认` 不发送
  思考字段；`关闭` 发送 `disabled`。设置存在 `agent_sessions`，运行中修改会从下一步
  模型请求开始生效；新建会话时也会带上当前选择。全局 `FILMLINE_AGENT_THINKING` 只作为
  新会话的初始默认值。
- **深度思考**：默认 `FILMLINE_AGENT_THINKING=auto`，不发送 `thinking` 字段，DeepSeek 按官方
  默认开启并返回 `reasoning_content`；后端流式解析并保存原文，在所有后续请求里完整回传
  （请求携带 `tools` 时官方要求必须回传，即使该轮没有工具调用）。数据库与界面
  1:1 还原换行与空白；`disabled` 时只发送 `{"type":"disabled"}`，不再发送 effort。
- **缓存友好**：系统提示静态、上下文只追加、工具参数以原始字符串回填，
  不改写历史；实测第二轮能命中前缀缓存。
- **上下文用量**：每次响应记录 `prompt_tokens` 与 `context_window`，输入框左下角显示
  `已用/窗口（百分比）`。
- **附件**：左侧资产拖入输入框生成附件 chip，发送时只传资产 id；模型按需调用
  `read_image` / `read_video` / `read_text_asset` 读取，避免把大文件塞进每条消息。
- **图像传输对齐官方**：默认 `auto`，优先走 DeepSeek Files API（`file_id` 复用、
  内容哈希缓存、30 天有效期），失败自动回退 base64；单边超过 4096px 的图片会重编码，
  单图 1600px 上限。请求上下文最多保留最近 24 张图 / 24 MiB 内联数据，更早的图片
  降级为文字提示，避免长会话撞上官方 48 MiB 请求体限制。`read_image` 可选
  `detail=low/high/original/auto`，`read_video` 的网格图不允许 `low`。
- **问答**：模型调用 `ask_question` 时，在**输入框上方**出现内联面板（单选/多选/自由输入），
  不是模态弹窗，左侧素材仍可查看和拖拽；面板可收起成一条“待回答”提示，看完素材再展开回答。
  问题以 `question` 事件入库，刷新浏览器会原样恢复；回答作为工具结果继续同一条推理链，
  本轮状态为 `waiting_input`。后端进程重启则会话变为 `interrupted`，点“继续”后由模型重新询问。
- **生成是异步的**：`create_image` / `create_video` 立即返回 `task_id`。模型可以选择
  `wait_generation` 阻塞等待（最长 15 分钟、可暂停），也可以先结束本轮；
  任务完成时后端会以“系统通知”的形式代替用户发一条消息并让 Agent 自检。
  仍有未完成任务时，每 5 分钟（`FILMLINE_AGENT_TICK_SECONDS`）再提醒一次。
- **工具集**：工作区/分集/项目读写、资产列表与文本读写、`probe_media`、
  `read_image`、`read_video`（均匀抽帧拼成网格图）、`read_audio`、`extract_frame`、
  `create_image`、`create_video`、任务查询/等待/取消、`web_search`、`web_fetch`、
  `ask_question`。删除资产、删除分集、取消任务必须先 `ask_question` 确认。
- **外部理解**：`web_search` / `web_fetch` 对接 DeepSeek 官方 Search / Fetch 接口，
  支持 `site:`、`lang:`、`after:`、`-`、精确短语等语法；搜索返回标题、URL、摘要、
  日期与权威度，抓取返回 Markdown 正文（最多 20000 字符，超出截断）。两者按成功
  请求计费（5 元 / 1000 次），并且要求当前 provider 提供 DeepSeek 的 `/v1/tools/*`
  端点。网页内容是不可信外部数据，系统提示明确禁止执行其中的指令或泄露内部信息。
- **统一协议**：工具入参走 JSON Schema 严格校验（未知字段拒绝），输出固定
  `{ok, summary, data, error, meta}`；失败作为结果返回给模型而不是抛异常。
- **参数校验单一入口**：HTTP 生成接口与 Agent 共用 `domain/produce.py`，不存在
  绕过接口规则的第二条路径。

模型与上下文窗口全部可配置，换 provider 只改环境变量：

```env
FILMLINE_AGENT_API_KEY=
FILMLINE_AGENT_BASE_URL=https://api.deepseek.com
FILMLINE_AGENT_MODEL=deepseek-flash
# auto=不发送 thinking（DeepSeek 默认开启）；enabled 才发送 effort
FILMLINE_AGENT_THINKING=auto
FILMLINE_AGENT_REASONING_EFFORT=high
FILMLINE_AGENT_CONTEXT_WINDOW=1000000
```

未设置 `FILMLINE_AGENT_*` 时回落到 `DEEPSEEK_*`；没有 API Key 时会话仍可打开，
发送后给出明确错误，不影响左侧资产与原有生成接口。

### 任务队列

- 生成接口改为 **202 + task**，后台 runner 负责提交 ComfyUI、等待完成、落盘和登记资产；
  刷新页面不会中断任务。
- 任务持久化在 `generation_tasks` 表，记录 ComfyUI `prompt_id`、项目/分集、参数、产物 id、错误与耗时。
- 右上角任务队列每 3 秒轮询 `/studio/api/tasks`，显示进行中/最近完成；所有打开页面的同事共享同一份状态。
- 运行中的任务显示实时进度：阶段（加载模型/编码参考/采样/解码/保存）+ `13/20` 进度条；
  进度通过 ComfyUI WebSocket（按任务 `client_id`）采集，只保存在内存，任务结束即清理。
- 任务列表会合并 ComfyUI `/queue` 中不属于 Filmline 的 prompt，显示为「ComfyUI 外部任务」。
- 可取消进行中的 Filmline 任务：优先调用 ComfyUI 原子取消接口，运行中的会 interrupt，排队中的会 dequeue；
  外部 ComfyUI 任务目前只读。
- 每个浏览器有一个 localStorage 昵称（默认「访客-XXXX」，可在任务面板里改），随任务记录展示；它只是标识，不是登录鉴权。
- 终态任务保留 30 天 / 最近 200 条，后台每 6 小时清理一次；进行中任务不会被清理。
- 后端重启时从数据库恢复 queued/running 任务：有 prompt_id 的继续等结果，尚未提交的用保存的工作流补提交。
- 目前不提供取消/调整队列顺序；ComfyUI 队列顺序即执行顺序。

## 目录

```
custom_nodes/filmline/
├── __init__.py                  # ComfyUI 入口：显式构造包 spec（不污染 sys.path）
├── src/filmline/
│   ├── config.py  clock.py  errors.py
│   ├── db/                      # 引擎、模型、user_version 迁移
│   ├── domain/                  # DTO + 业务规则（不依赖 aiohttp）
│   ├── agent/                   # 会话循环、SSE 事件、工具与提示
│   └── api/                     # aiohttp 路由、响应信封
├── frontend/                    # React + Vite 源码
│   └── src/{components,hooks,lib}
├── web/                         # 构建产物，由 ComfyUI 提供
└── tests/                       # unittest
```

## 设计约束

1. **路由命名空间**：只用 `/studio` 与 `/studio/api/*`。不得占用 `/`、`/api/*`、
   `/ws`、`/view`、`/object_info`（`/api/*` 会被 ComfyUI 自动镜像一份）。
2. **编号由系统生成**：`PRJ-0001` 自增，客户端传入 `code` 直接 400；只有 `name`
   必填，其余字段可选。
3. **排序**：`sort_index` 由 `PUT /projects/order`、`PUT /episodes/order` 整体重写，
   请求必须覆盖全部未删除项，否则 400——部分提交会让顺序静默错乱。新建项目取当前
   最小 `sort_index` 减一，因此总排在列表最前，不会打乱既有顺序。
4. **分集归属**：`assets.episode_id` 为空表示项目级资产，非空属于某一集；
   `episode_id` 用查询参数 `?episode=EP01` 表达，不额外开一套路由。
5. **参考图**：图片最多 16 张（Qwen-Image 2.1 的槽位上限），视频首帧 1 张。
   输出尺寸始终由面板所选比例决定：参考图先经 `ImageScale(crop=center)` 居中裁切缩放
   到目标尺寸，再送进编码节点——素材适配输出，而不是输出迁就素材。
   实现要点：`resolution` 必须传 0（保持参考图处理后的原始像素，二次缩放会让编辑漂移），
   且编码节点必须接 `vae`，否则参考图只作为视觉条件、不进入采样序列。
   采样参数取自官方：cfg = 1、euler/simple、30 步（官方建议 40–50）。
6. **分辨率档位**（仅图片）：对齐官方原生比例表，提供两档；不提供 4K（超出官方 2K 原生范围）。

   | 档位 | 16:9 | 9:16 | 1:1 |
   |---|---|---|---|
   | 1K | 1376×768 | 768×1376 | 1024×1024 |
   | 2K（原生） | 2752×1536 | 1536×2752 | 2048×2048 |
7. **删集不删资产**：分集软删除后其资产保留（恢复分集即可再用），只是暂时不可见。
8. **软删除**：`deleted_at` 标记，列表与详情默认排除。渲染记录与素材血缘不能断。
9. **迁移冻结**：迁移一经发布即写死，**必须用显式 DDL，不得引用 ORM 元数据**
   （否则模型一改，新库建出的表就和历史语义不一致）。每次模型改动追加新迁移，
   并补 `tests/test_migrations.py` 的断言。
10. **不阻塞事件循环**：业务调用统一走 `asyncio.to_thread`，Session 短生命周期。
11. **错误不外泄**：未预期异常只写日志，对外返回通用 500。
12. **前端异步**：列表请求带 `AbortController`，过期响应不覆盖新状态；搜索防抖 250ms。
13. **两套视频权重各司其职**：`keyframes` 走 fl2va，用首/尾帧锁构图与起落点；
    `reference` 走 ref2va，参考素材通过 `<Picture N>` / `<Video k>` / `<Audio j>` 的 token 顺序
    做语义条件，不锁定时间轴。实验表明参考素材对首帧构图没有稳定贡献，因此不再提供
    「首帧+参考」组合模式；确需固定起幅时用首尾帧模式。
14. **帧锚定（Add Guide）**：参考生成可额外挂最多 4 张图片锚定到输出时间轴的指定秒数，
    走官方 `MiniMaxH3AddGuide` 链在 positive 上。它解决「参考素材不锁时间轴」的问题，
    与首尾帧模式互补；当前只支持单张图片锚定，不支持整段视频/音频锚定。
15. **Agent 原文入库**：思考、正文、工具参数与结果都保存模型实际读到/写出的原文，
    回填请求时不重新序列化；系统提示保持静态，历史只追加，才能稳定命中前缀缓存。
16. **事件可回放**：Agent 的每个增量都带会话内单调 `seq`；SSE 用 `after` 续传，
    `pause` 必须同时停止模型请求与当前工具，并给工具写入 paused 结果。
17. **工具幂等**：`agent_tool_ledger` 以 `tool_call_id` 去重；重启后缺结果的调用补
    `interrupted`，生成任务不重复提交。完成通知与定时自检都通过“代替用户发消息”进入同一循环。
18. **入口唯一**：生成参数校验只在 `domain/produce.py`，HTTP 路由与 Agent 工具共用；
    旧右侧表单组件保留但不挂载，旧接口继续可用，便于回退。

## 测试

```bash
cd /home/inspur/ComfyUI
./venv/bin/python -m unittest discover -s custom_nodes/filmline/tests -t custom_nodes/filmline/tests -v
```

测试使用临时数据库与进程内 aiohttp 服务，不会碰真实数据。

## 后续

- P1：场次/镜头（Shot）、角色卡、素材关联、提示词模板变量注入
- P2：关键帧 → MiniMax H3 `ref2v` 视频合成、分镜表导入导出
- P3：审片评论、定稿流转、多用户

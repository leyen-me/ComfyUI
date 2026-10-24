# Filmline

影视制片管线，以 ComfyUI 扩展的形式运行，**不修改 ComfyUI 任何源码**，
只通过官方扩展点注册 HTTP 路由。

当前进度：P0 —— 项目（Project）CRUD + 深色前端。

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
  侧边栏可切换浅色，偏好持久化。
- **路由**：`/studio` 项目列表，`/studio/projects/{编号}` 项目详情。后端对
  `/studio/*` 做 SPA 回落（`/studio/api/*`、`/studio/static/*` 除外）。
- **项目内布局**：左侧项目导航（项目资产 + 分集列表），中间资产面板
  （分类用顶部标签页：文本 / 图片 / 视频 / 音频），右侧对话输入框。
  项目页不套全局侧边栏。
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
| GET | `/studio/api/projects` | 列表，支持 `q` / `limit` / `offset`，按手动排序返回 |
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
| GET | `/studio/api/projects/{ref}/assets` | 资产列表，`kind=text\|image\|video\|audio`，`episode=EP01` 限定分集 |
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

## 视频生成参数（对齐官方）

| 项 | 取值 | 依据 |
|---|---|---|
| 分辨率 | 短边 768（1344×768 / 768×1344） | 官方原生画布，上限 768×1344；不提供低档（实测不省时间） |
| 时长 | 5–15 秒（预设 5/8/10/12/15，自定义整数秒） | 模型训练区间 124–362 帧（≈5.2–15.1 秒）；24fps，帧数向上对齐 17k+5 |
| 采样 | `res_multistep` + `simple`，4 步 | 官方模板 SamplerCustomAdvanced |
| cfg | 1.0（等价 BasicGuider） | 权重为 CFG 蒸馏 |
| LoRA | `minimax_h3_fl2v_turbo_4step_v1.0_768p` | 与本地已有权重匹配 |
| 提示词 | 建议包含镜头、运镜与声音（对白/音效/配乐） | 该模型联合生成音视频 |

### 视频生成方式

视频面板下分两种条件输入方式，对应 H3 的两套权重，不能混用：

- **首尾帧**（已实现，`fl2va`）：上方两个独立槽位，可拖入或点击选择图片；两个都留空为文生视频，
  只填一个即首帧或尾帧生视频。图片会按输出比例居中裁切，比例不一致时槽位下方会提示。
  把视频拖进槽位会打开选帧对话框，截取任意一帧保存为图片资产后作为首/尾帧，用于连续镜头。
  连贯镜头的常用做法：把上一段视频拖到首帧槽位，点「末帧」，用这一帧作为下一段的首帧。
  请求字段：`mode=keyframes`、`first_frame_id`、`last_frame_id`。
- **参考生成**（已实现图片/视频/音频，`ref2va`）：图片 ≤9、视频 ≤3、独立音频 ≤3，所有文件合计 ≤12；
  视频/音频每段 2–15 秒，视频总时长 ≤15 秒、音频总时长 ≤15 秒。顺序决定提示词里的
  `<Picture i>`、`<Video k>`、`<Audio j>`；参考素材不会锁定第 0 帧。请求字段：
  `mode=reference`、`refs=[图片 id]`、`ref_videos=[{asset_id, use_audio}]`、`ref_audios=[音频 id]`。
  参考视频会重采样到 24fps、短边压到 512 并截断到输出时长；视频原声占用一个 `<Audio j>`，
  独立音频排在所有原声之后。当前使用 8 步 turbo。

生成结果 `meta` 会记录 `video_mode`、`first_frame_id` / `last_frame_id`（首尾帧）或
`ref_ids` / `ref_video_ids` / `ref_video_use_audio` / `ref_audio_ids`（参考素材），供前端还原；
旧视频资产只有 `ref_ids` 时按首帧兼容。

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
- 内置确定性 Lint：裸引号对白、缺少说话人、缺少“无字幕”、参考托盘有素材但提示词没标签、误用 `图1` / `<imageN>`、超长等。
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
- 会附带当前首尾帧或参考图片（最多 4 张）给 DeepSeek，让它理解画面里谁在说话、嘴/喙是否张开、构图和背景；**不上传视频/音频文件**。
- 图片由后端按资产 id 读取并转 data URL，前端只传 id 和标签；发送前会限制单张/总大小。
- 发送给 DeepSeek 的还有提示词文本和参考标签（`<Picture 1>` 等）。
- 长度策略：结果必须 ≤ 4000 字符（与生成接口一致）；模型输出超长时自动压缩一次，
  不会直接报错。草稿本身允许到 12000 字符，由 AI 压缩到上限以内。
- 格式策略：思考 token 计入 `max_tokens`，预算不足会把 JSON 截断；默认 4096，
  并在截断/非法 JSON 时自动重试一次（重试预算翻倍），仍失败才返回明确错误。
- 失败、超时、返回格式异常都会保留原文，不阻塞生成；应用前可人工修改。

### 任务队列

- 生成接口改为 **202 + task**，后台 runner 负责提交 ComfyUI、等待完成、落盘和登记资产；
  刷新页面不会中断任务。
- 任务持久化在 `generation_tasks` 表，记录 ComfyUI `prompt_id`、项目/分集、参数、产物 id、错误与耗时。
- 右上角任务队列每 3 秒轮询 `/studio/api/tasks`，显示进行中/最近完成；所有打开页面的同事共享同一份状态。
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

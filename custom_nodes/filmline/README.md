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
npm run test:logic   # 纯函数单测（页码计算）
```

## 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/studio/api/projects` | 列表，支持 `q` / `limit` / `offset`，按手动排序返回 |
| POST | `/studio/api/projects` | 新建，`{name, description?}`，编号由系统生成，追加到末尾 |
| PUT | `/studio/api/projects/order` | 拖拽排序，`{ids: [...]}` 必须覆盖全部项目 |
| GET | `/studio/api/projects/{ref}` | 详情，`ref` 可为数字 id 或项目编号 |
| PATCH | `/studio/api/projects/{ref}` | 更新 `name` / `description` |
| DELETE | `/studio/api/projects/{ref}` | 软删除，返回 204 |
| GET | `/studio/api/health` | 版本、库路径、schema 版本、项目数 |

统一响应信封：

```json
{"ok": true,  "data": {...}, "ts": "2026-10-24T07:40:03.123Z"}
{"ok": false, "error": {"code": "invalid_argument", "message": "参数校验失败", "details": [...]}, "ts": "..."}
```

错误码：`invalid_argument` (400)、`not_found` (404)、`conflict` (409)、`internal_error` (500)。

## 数据位置

```
ComfyUI/user/filmline/filmline.db     # 默认，跟随 --user-directory，升级不丢
```

可用环境变量覆盖：

| 变量 | 作用 |
|---|---|
| `FILMLINE_DATA_DIR` | 数据根目录（未来放缩略图、导出文件） |
| `FILMLINE_DB_PATH` | 直接指定数据库文件 |

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
3. **排序**：`sort_index` 由 `PUT /projects/order` 整体重写，请求必须覆盖全部
   未删除项目，否则 400——部分提交会让顺序静默错乱。
3. **软删除**：`deleted_at` 标记，列表与详情默认排除。渲染记录与素材血缘不能断。
4. **迁移冻结**：迁移一经发布即写死，**必须用显式 DDL，不得引用 ORM 元数据**
   （否则模型一改，新库建出的表就和历史语义不一致）。每次模型改动追加新迁移，
   并补 `tests/test_migrations.py` 的断言。
5. **不阻塞事件循环**：业务调用统一走 `asyncio.to_thread`，Session 短生命周期。
6. **错误不外泄**：未预期异常只写日志，对外返回通用 500。
7. **前端异步**：列表请求带 `AbortController`，过期响应不覆盖新状态；搜索防抖 250ms。

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

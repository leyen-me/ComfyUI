"""项目 / 分集 / 工作区上下文工具。"""

from __future__ import annotations

from ...domain.assets import AssetService
from ...domain.episodes import EpisodeService
from ...domain.projects import ProjectService
from ...domain.schemas import EpisodeCreate, EpisodeUpdate, ProjectCreate, ProjectUpdate
from ...domain.tasks import TaskService
from ...errors import NotFound
from .base import Tool, ToolContext, ToolOutcome, register

async def _context(ctx: ToolContext, args: dict) -> ToolOutcome:
    project = await _to_thread(ProjectService().get, ctx.project_code)
    episodes = await _to_thread(EpisodeService().list, project.id)
    counts = await _to_thread(AssetService().counts, project.id)
    tasks = await _to_thread(TaskService().list, limit=10, active_only=True)
    return ToolOutcome(
        summary=f"{project.code}「{project.name}」，{len(episodes)} 个分集，{counts.text + counts.image + counts.video + counts.audio} 个项目级资产",
        data={
            "project": {
                "id": project.id,
                "code": project.code,
                "name": project.name,
                "description": project.description,
            },
            "episodes": [
                {
                    "code": item.code,
                    "title": item.title,
                    "synopsis": item.synopsis,
                }
                for item in episodes
            ],
            "asset_counts": {
                "text": counts.text,
                "image": counts.image,
                "video": counts.video,
                "audio": counts.audio,
            },
            "active_tasks": [
                {
                    "id": task.id,
                    "kind": task.kind,
                    "status": task.status,
                    "project": task.project_code,
                    "episode": task.episode_code,
                    "excerpt": task.prompt_excerpt,
                }
                for task in tasks
                if task.project_id == project.id
            ],
            "notes": [
                "资产分项目级与分集级：list_assets 的 episode 参数决定作用域，不传只看项目级。",
                "生成任务异步执行；提交后用 get_generation_task / wait_generation 查询，完成也会通知。",
                "删除类工具必须先用 ask_question 取得用户确认，再带 confirmed=true 调用。",
            ],
        },
    )


async def _to_thread(fn, *args, **kwargs):
    import asyncio

    return await asyncio.to_thread(fn, *args, **kwargs)


async def _list_episodes(ctx: ToolContext, args: dict) -> ToolOutcome:
    episodes = await _to_thread(EpisodeService().list, ctx.project_id)
    return ToolOutcome(
        summary=f"共 {len(episodes)} 个分集",
        data={
            "episodes": [
                {"code": item.code, "title": item.title, "synopsis": item.synopsis}
                for item in episodes
            ]
        },
    )


async def _create_episode(ctx: ToolContext, args: dict) -> ToolOutcome:
    episode = await _to_thread(
        EpisodeService().create,
        ctx.project_id,
        EpisodeCreate(title=args["title"], synopsis=args.get("synopsis", "")),
    )
    return ToolOutcome(
        summary=f"已新建分集 {episode.code}「{episode.title}」",
        data={"id": episode.id, "code": episode.code, "title": episode.title},
    )


async def _update_episode(ctx: ToolContext, args: dict) -> ToolOutcome:
    episodes = await _to_thread(EpisodeService().list, ctx.project_id)
    target = next((item for item in episodes if item.code == args["code"].upper()), None)
    if target is None:
        raise NotFound(f"分集不存在: {args['code']}")
    payload = EpisodeUpdate(
        title=args.get("title"), synopsis=args.get("synopsis")
    )
    episode = await _to_thread(EpisodeService().update, target.id, payload)
    return ToolOutcome(
        summary=f"已更新分集 {episode.code}",
        data={"code": episode.code, "title": episode.title, "synopsis": episode.synopsis},
    )


async def _delete_episode(ctx: ToolContext, args: dict) -> ToolOutcome:
    if not args.get("confirmed"):
        return ToolOutcome(
            ok=False,
            summary="删除分集需要用户确认",
            error={
                "code": "confirmation_required",
                "message": "请先调用 ask_question 让用户确认，再带 confirmed=true 重试",
            },
        )
    episodes = await _to_thread(EpisodeService().list, ctx.project_id)
    target = next((item for item in episodes if item.code == args["code"].upper()), None)
    if target is None:
        raise NotFound(f"分集不存在: {args['code']}")
    await _to_thread(EpisodeService().delete, target.id)
    return ToolOutcome(summary=f"已删除分集 {target.code}（资产保留）")


async def _create_project(ctx: ToolContext, args: dict) -> ToolOutcome:
    project = await _to_thread(
        ProjectService().create,
        ProjectCreate(name=args["name"], description=args.get("description", "")),
    )
    return ToolOutcome(
        summary=f"已新建项目 {project.code}「{project.name}」",
        data={"id": project.id, "code": project.code, "name": project.name},
    )


async def _update_project(ctx: ToolContext, args: dict) -> ToolOutcome:
    payload = ProjectUpdate(name=args.get("name"), description=args.get("description"))
    project = await _to_thread(ProjectService().update, ctx.project_code, payload)
    return ToolOutcome(
        summary=f"已更新项目 {project.code}",
        data={"code": project.code, "name": project.name, "description": project.description},
    )


def register_tools() -> None:
    register(
        Tool(
            name="get_workspace_context",
            label="读取工作区",
            description="读取当前项目、分集列表、资产数量与正在运行的生成任务。每轮先调用一次了解现状。",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            handler=_context,
        )
    )
    register(
        Tool(
            name="list_episodes",
            label="列出分集",
            description="列出当前项目的全部分集。",
            parameters={"type": "object", "properties": {}, "additionalProperties": False},
            handler=_list_episodes,
        )
    )
    register(
        Tool(
            name="create_episode",
            label="新建分集",
            description="在当前项目下新建一集，编号由系统生成。",
            parameters={
                "type": "object",
                "properties": {
                    "title": {"type": "string", "minLength": 1, "maxLength": 200},
                    "synopsis": {"type": "string", "maxLength": 4000},
                },
                "required": ["title"],
                "additionalProperties": False,
            },
            handler=_create_episode,
            write=True,
        )
    )
    register(
        Tool(
            name="update_episode",
            label="修改分集",
            description="修改分集标题或简介。",
            parameters={
                "type": "object",
                "properties": {
                    "code": {"type": "string", "minLength": 1, "maxLength": 16},
                    "title": {"type": "string", "minLength": 1, "maxLength": 200},
                    "synopsis": {"type": "string", "maxLength": 4000},
                },
                "required": ["code"],
                "additionalProperties": False,
            },
            handler=_update_episode,
            write=True,
        )
    )
    register(
        Tool(
            name="delete_episode",
            label="删除分集",
            description="软删除分集，资产保留。必须先 ask_question 征得用户同意。",
            parameters={
                "type": "object",
                "properties": {
                    "code": {"type": "string", "minLength": 1, "maxLength": 16},
                    "confirmed": {"type": "boolean"},
                },
                "required": ["code"],
                "additionalProperties": False,
            },
            handler=_delete_episode,
            write=True,
            destructive=True,
        )
    )
    register(
        Tool(
            name="create_project",
            label="新建项目",
            description="新建一个项目（不会自动切换当前会话的项目）。",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 120},
                    "description": {"type": "string", "maxLength": 4000},
                },
                "required": ["name"],
                "additionalProperties": False,
            },
            handler=_create_project,
            write=True,
        )
    )
    register(
        Tool(
            name="update_project",
            label="修改项目",
            description="修改当前项目的名称或简介。",
            parameters={
                "type": "object",
                "properties": {
                    "name": {"type": "string", "minLength": 1, "maxLength": 120},
                    "description": {"type": "string", "maxLength": 4000},
                },
                "additionalProperties": False,
            },
            handler=_update_project,
            write=True,
        )
    )

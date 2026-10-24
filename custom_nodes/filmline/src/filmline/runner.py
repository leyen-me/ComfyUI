"""后台生成任务执行器。

HTTP 请求只创建任务并立即返回；真正的提交/等待/落盘都在这里完成。
这样刷新页面不会中断任务，后端重启也能从数据库恢复。
"""

from __future__ import annotations

import asyncio
import logging

from aiohttp import web

from . import generation, pipeline
from .clock import utcnow
from .domain.tasks import ACTIVE_STATUSES, TaskService
from .generation import Workflow

_LOG = logging.getLogger("filmline")


class TaskRunner:
    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._recovery: asyncio.Task[None] | None = None

    async def start(self, app: web.Application) -> None:
        app[RUNNER_KEY] = self
        self._recovery = asyncio.create_task(self._recover(), name="filmline-recover-tasks")
        _LOG.info("生成任务执行器已启动")

    async def stop(self, app: web.Application) -> None:
        if self._recovery is not None:
            self._recovery.cancel()
            await asyncio.gather(self._recovery, return_exceptions=True)
            self._recovery = None
        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()

    def schedule(self, task_id: int) -> None:
        existing = self._tasks.get(task_id)
        if existing is not None and not existing.done():
            return
        task = asyncio.create_task(self._run(task_id), name=f"filmline-task-{task_id}")
        self._tasks[task_id] = task

        def _done(_: asyncio.Task[None]) -> None:
            self._tasks.pop(task_id, None)

        task.add_done_callback(_done)

    async def _recover(self) -> None:
        try:
            records = await asyncio.to_thread(TaskService().recoverable)
        except Exception:
            _LOG.exception("恢复生成任务失败")
            return
        if records:
            _LOG.info("恢复 %s 个未完成生成任务", len(records))
        for record in records:
            self.schedule(record.id)

    async def _run(self, task_id: int) -> None:
        service = TaskService()
        try:
            record = await asyncio.to_thread(service.get_record, task_id)
        except Exception:
            _LOG.exception("读取生成任务失败: %s", task_id)
            return

        if record.status not in ACTIVE_STATUSES:
            return

        payload = record.payload or {}
        graph = payload.get("graph")
        meta = payload.get("meta") or {}
        scope = str(payload.get("scope") or "project")
        if not isinstance(graph, dict) or not graph:
            await asyncio.to_thread(
                service.mark_failed, task_id, error="任务缺少工作流，无法恢复"
            )
            return

        workflow = Workflow(prompt=graph, kind=record.kind, meta=meta)
        started_at = record.started_at

        try:
            prompt_id = record.prompt_id
            if not prompt_id:
                if record.status == "running":
                    await asyncio.to_thread(
                        service.mark_failed,
                        task_id,
                        error="任务缺少 ComfyUI prompt_id，无法恢复",
                    )
                    return
                prompt_id = await generation.submit(workflow, client_id=record.client_id)
                started_at = utcnow()
                await asyncio.to_thread(
                    service.mark_running,
                    task_id,
                    prompt_id=prompt_id,
                    started_at=started_at,
                )
            elif started_at is None:
                started_at = utcnow()

            products, exec_seconds = await generation.collect(
                prompt_id,
                kind=record.kind,
                timeout=generation.timeout_for(record.kind),
            )

            wall = (utcnow() - started_at).total_seconds() if started_at else 0.0
            # 展示耗时优先用 ComfyUI 的真实执行时间；排队时间单独记录
            elapsed = round(exec_seconds, 1) if exec_seconds is not None else round(wall, 1)
            queue_ms = max(0, int(round((wall - elapsed) * 1000)))

            asset_ids = await asyncio.to_thread(
                pipeline.register_products,
                project_id=record.project_id,
                episode_id=record.episode_id,
                scope=scope,
                kind=record.kind,
                meta=meta,
                products=products,
                elapsed_seconds=elapsed,
                gen_started_at=started_at,
                queue_ms=queue_ms,
            )
            await asyncio.to_thread(
                service.mark_succeeded,
                task_id,
                asset_ids=asset_ids,
                elapsed_ms=int(elapsed * 1000),
            )
            _LOG.info("生成任务完成: %s (%s 个资产)", task_id, len(asset_ids))
        except asyncio.CancelledError:
            # 进程关闭/重启：保留 running 状态，下次启动继续等 ComfyUI 完成
            raise
        except Exception as exc:
            _LOG.exception("生成任务失败: %s", task_id)
            message = str(exc) or exc.__class__.__name__
            await asyncio.to_thread(service.mark_failed, task_id, error=message)


RUNNER_KEY: web.AppKey[TaskRunner] = web.AppKey("filmline_task_runner", TaskRunner)

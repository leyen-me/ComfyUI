"""任务服务测试：状态流转、取消保护与历史清理。"""

from __future__ import annotations

import unittest
from datetime import timedelta

from base import DbTestCase
from filmline.clock import utcnow
from filmline.domain.projects import ProjectService
from filmline.domain.schemas import ProjectCreate
from filmline.domain.tasks import TaskService


class TaskServiceTest(DbTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.project = ProjectService().create(ProjectCreate(name="任务测试"))
        self.service = TaskService()

    def _task(self, prompt: str = "x"):
        return self.service.create(
            project_id=self.project.id,
            episode_id=None,
            kind="image",
            prompt=prompt,
            payload={"graph": {"1": {"class_type": "SaveImage", "inputs": {}}}, "meta": {}, "scope": "project"},
        )

    def test_status_transitions(self) -> None:
        task = self._task()
        self.assertEqual(task.status, "queued")
        self.assertTrue(
            self.service.mark_running(task.id, prompt_id="prompt-1", started_at=utcnow())
        )
        self.assertFalse(
            self.service.mark_running(task.id, prompt_id="prompt-2", started_at=utcnow())
        )
        self.service.mark_succeeded(task.id, asset_ids=[1, 2], elapsed_ms=1200)
        fetched = self.service.get(task.id)
        self.assertEqual(fetched.status, "succeeded")
        self.assertEqual(fetched.asset_ids, [1, 2])
        self.assertEqual(fetched.elapsed_ms, 1200)

    def test_cancel_does_not_override_terminal(self) -> None:
        task = self._task()
        self.service.mark_succeeded(task.id, asset_ids=[1], elapsed_ms=100)
        self.service.mark_cancelled(task.id)
        self.assertEqual(self.service.get(task.id).status, "succeeded")

    def test_recoverable_only_active(self) -> None:
        queued = self._task("queued")
        running = self._task("running")
        self.service.mark_running(running.id, prompt_id="p", started_at=utcnow())
        done = self._task("done")
        self.service.mark_succeeded(done.id, asset_ids=[], elapsed_ms=10)
        ids = {item.id for item in self.service.recoverable()}
        self.assertEqual(ids, {queued.id, running.id})

    def test_prune_old_and_extra_terminal_tasks(self) -> None:
        old = self._task("old")
        recent = self._task("recent")
        active = self._task("active")
        self.service.mark_succeeded(
            old.id,
            asset_ids=[],
            elapsed_ms=10,
            finished_at=utcnow() - timedelta(days=40),
        )
        self.service.mark_succeeded(
            recent.id,
            asset_ids=[],
            elapsed_ms=10,
            finished_at=utcnow(),
        )
        self.service.mark_running(active.id, prompt_id="p", started_at=utcnow())

        deleted = self.service.prune(keep_days=30, keep_count=200)
        self.assertEqual(deleted, 1)
        remaining = {item.id for item in self.service.list()}
        self.assertNotIn(old.id, remaining)
        self.assertIn(recent.id, remaining)
        self.assertIn(active.id, remaining)

        # 超出 keep_count 的终态任务也会被清理，但进行中任务保留
        extra = self._task("extra")
        self.service.mark_succeeded(extra.id, asset_ids=[], elapsed_ms=10)
        deleted = self.service.prune(keep_days=30, keep_count=1)
        self.assertGreaterEqual(deleted, 1)
        remaining = {item.id for item in self.service.list()}
        self.assertIn(active.id, remaining)


if __name__ == "__main__":
    unittest.main()

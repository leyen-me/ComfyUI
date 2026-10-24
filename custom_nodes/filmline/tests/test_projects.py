"""项目领域逻辑测试。"""

from __future__ import annotations

import time
import unittest

from pydantic import ValidationError

from base import DbTestCase
from filmline.domain.projects import ProjectService
from filmline.domain.schemas import ProjectCreate, ProjectUpdate
from filmline.errors import InvalidArgument, NotFound


class ProjectServiceTest(DbTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.service = ProjectService()

    def _create(self, name="测试项目", **kwargs):
        return self.service.create(ProjectCreate(name=name, **kwargs))

    def test_create_generates_sequential_code(self) -> None:
        first = self._create("甲")
        second = self._create("乙")
        self.assertEqual(first.code, "PRJ-0001")
        self.assertEqual(second.code, "PRJ-0002")
        self.assertTrue(first.created_at.endswith("Z"))

    def test_create_only_requires_name(self) -> None:
        project = self._create("甲")
        self.assertEqual(project.description, "")

    def test_blank_name_rejected(self) -> None:
        with self.assertRaises(ValidationError):
            ProjectCreate(name="   ")

    def test_code_and_status_are_not_accepted(self) -> None:
        """编号由系统生成；项目没有状态字段。"""
        with self.assertRaises(ValidationError):
            ProjectCreate(name="甲", code="CUSTOM")
        with self.assertRaises(ValidationError):
            ProjectCreate(name="甲", status="active")

    def test_get_by_id_and_code(self) -> None:
        project = self._create("甲")
        self.assertEqual(self.service.get(project.id).id, project.id)
        self.assertEqual(self.service.get(project.code).id, project.id)
        with self.assertRaises(NotFound):
            self.service.get("PRJ-9999")

    def test_list_filters_and_pagination(self) -> None:
        self._create("长安十二时辰")
        self._create("长安 · 番外")
        self._create("无关项目")

        self.assertEqual(self.service.list().total, 3)
        self.assertEqual(self.service.list(q="长安").total, 2)
        self.assertEqual(len(self.service.list(limit=2).items), 2)
        self.assertEqual(self.service.list(limit=2, offset=2).total, 3)

    def test_wildcard_in_search_is_literal(self) -> None:
        self._create("100% 完成")
        self._create("普通项目")
        self.assertEqual(self.service.list(q="%").total, 1)

    def test_update_partial(self) -> None:
        project = self._create("旧名")
        renamed = self.service.update(project.id, ProjectUpdate(name="新名"))
        self.assertEqual(renamed.name, "新名")
        self.assertEqual(renamed.description, "")

        described = self.service.update(project.code, ProjectUpdate(description="简介"))
        self.assertEqual(described.description, "简介")

    def test_update_rejects_empty_and_immutable_fields(self) -> None:
        project = self._create("甲")
        with self.assertRaises(InvalidArgument):
            self.service.update(project.id, ProjectUpdate())
        with self.assertRaises(ValidationError):
            ProjectUpdate(code="PRJ-HACK")
        with self.assertRaises(ValidationError):
            ProjectUpdate(status="archived")

    def test_update_touches_timestamp(self) -> None:
        project = self._create("甲")
        time.sleep(0.02)
        updated = self.service.update(project.id, ProjectUpdate(name="乙"))
        self.assertGreater(updated.updated_at, project.updated_at)

    def test_delete_is_soft(self) -> None:
        project = self._create("甲")
        self.service.delete(project.id)
        with self.assertRaises(NotFound):
            self.service.get(project.id)
        self.assertEqual(self.service.list().total, 0)
        with self.assertRaises(NotFound):
            self.service.delete(project.id)

    def test_limit_guard(self) -> None:
        with self.assertRaises(InvalidArgument):
            self.service.list(limit=0)
        with self.assertRaises(InvalidArgument):
            self.service.list(limit=10_000)


if __name__ == "__main__":
    unittest.main()

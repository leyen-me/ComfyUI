"""迁移测试：守住“迁移冻结”与最终 schema，防止模型改动漏迁移。"""

from __future__ import annotations

import unittest

from base import DbTestCase
from filmline import db
from filmline.db.migrations import MIGRATIONS, current_version


class MigrationTest(DbTestCase):
    def test_reaches_latest_version(self) -> None:
        engine = db.get_engine()
        latest = max(version for version, _ in MIGRATIONS)
        self.assertEqual(current_version(engine), latest)

    def test_projects_schema_matches_models(self) -> None:
        """列名集合必须与 ORM 模型一致，否则说明漏了迁移。"""
        from filmline.db.models import Project

        engine = db.get_engine()
        with engine.connect() as conn:
            actual = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(projects)")}
        self.assertEqual(actual, set(Project.__table__.columns.keys()))

    def test_project_has_no_status_column(self) -> None:
        engine = db.get_engine()
        with engine.connect() as conn:
            columns = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(projects)")}
        self.assertNotIn("status", columns)


if __name__ == "__main__":
    unittest.main()

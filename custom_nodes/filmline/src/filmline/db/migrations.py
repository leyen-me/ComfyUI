"""版本化迁移。

约定：
* **迁移一经发布即冻结**，必须写显式 DDL，不得引用 ORM 元数据——否则模型一改，
  历史迁移的语义就变了，新库建出来的表和老库不一致；
* 每次模型改动都追加一条新迁移，并补一条 ``test_migrations`` 断言。
"""

from __future__ import annotations

import logging

from sqlalchemy import Connection, Engine

_LOG = logging.getLogger("filmline")


def _migration_001_initial(conn: Connection) -> None:
    """初始 schema（含当时的 status 列，v2 会删掉）。"""
    conn.exec_driver_sql(
        """
        CREATE TABLE projects (
            id INTEGER NOT NULL,
            code VARCHAR(32) NOT NULL,
            name VARCHAR(120) NOT NULL,
            description TEXT DEFAULT '' NOT NULL,
            status VARCHAR(16) DEFAULT 'draft' NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME,
            PRIMARY KEY (id),
            UNIQUE (code)
        )
        """
    )
    for index, column in (
        ("ix_projects_code", "code"),
        ("ix_projects_name", "name"),
        ("ix_projects_status", "status"),
        ("ix_projects_updated_at", "updated_at"),
        ("ix_projects_deleted_at", "deleted_at"),
    ):
        conn.exec_driver_sql(f"CREATE INDEX {index} ON projects ({column})")


def _migration_002_drop_project_status(conn: Connection) -> None:
    """项目不再有状态。SQLite 要求先删掉列上的索引才能 DROP COLUMN。"""
    conn.exec_driver_sql("DROP INDEX IF EXISTS ix_projects_status")
    conn.exec_driver_sql("ALTER TABLE projects DROP COLUMN status")


def _migration_003_project_sort_index(conn: Connection) -> None:
    """项目支持拖拽排序；已有数据按创建顺序初始化。"""
    conn.exec_driver_sql("ALTER TABLE projects ADD COLUMN sort_index INTEGER NOT NULL DEFAULT 0")
    conn.exec_driver_sql("UPDATE projects SET sort_index = id")
    conn.exec_driver_sql("CREATE INDEX ix_projects_sort_index ON projects (sort_index)")


def _migration_004_assets(conn: Connection) -> None:
    """项目资产：文本 / 图片 / 视频，带来源标记。"""
    conn.exec_driver_sql(
        """
        CREATE TABLE assets (
            id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            kind VARCHAR(8) NOT NULL,
            source VARCHAR(8) NOT NULL,
            name VARCHAR(200) NOT NULL,
            text_content TEXT,
            file_path VARCHAR(500),
            mime_type VARCHAR(100),
            size_bytes INTEGER,
            meta JSON,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES projects (id)
        )
        """
    )
    for index, column in (
        ("ix_assets_project_id", "project_id"),
        ("ix_assets_kind", "kind"),
        ("ix_assets_source", "source"),
        ("ix_assets_created_at", "created_at"),
        ("ix_assets_deleted_at", "deleted_at"),
    ):
        conn.exec_driver_sql(f"CREATE INDEX {index} ON assets ({column})")


def _migration_005_episodes(conn: Connection) -> None:
    """分集与资产归属；资产增加 audio 类型（kind 是字符串，无需改表结构）。"""
    conn.exec_driver_sql(
        """
        CREATE TABLE episodes (
            id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            number INTEGER NOT NULL,
            code VARCHAR(16) NOT NULL,
            title VARCHAR(200) NOT NULL,
            synopsis TEXT DEFAULT '' NOT NULL,
            sort_index INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES projects (id)
        )
        """
    )
    conn.exec_driver_sql("CREATE INDEX ix_episodes_project_id ON episodes (project_id)")
    conn.exec_driver_sql("CREATE INDEX ix_episodes_deleted_at ON episodes (deleted_at)")
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_episodes_project_code ON episodes (project_id, code)"
    )

    conn.exec_driver_sql(
        "ALTER TABLE assets ADD COLUMN episode_id INTEGER REFERENCES episodes (id)"
    )
    conn.exec_driver_sql("CREATE INDEX ix_assets_episode_id ON assets (episode_id)")


MIGRATIONS: list[tuple[int, object]] = [
    (1, _migration_001_initial),
    (2, _migration_002_drop_project_status),
    (3, _migration_003_project_sort_index),
    (4, _migration_004_assets),
    (5, _migration_005_episodes),
]


def current_version(engine: Engine) -> int:
    with engine.connect() as conn:
        return int(conn.exec_driver_sql("PRAGMA user_version").scalar_one())


def migrate(engine: Engine) -> int:
    """把库升级到最新版本，返回最终版本号。"""
    version = current_version(engine)
    for target, step in MIGRATIONS:
        if target <= version:
            continue
        _LOG.info("应用数据库迁移 v%s", target)
        with engine.begin() as conn:
            step(conn)  # type: ignore[operator]
            # user_version 不支持参数绑定；target 来自本模块常量，非外部输入
            conn.exec_driver_sql(f"PRAGMA user_version = {int(target)}")
        version = target
    return version

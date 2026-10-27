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


def _migration_006_generation_stats(conn: Connection) -> None:
    """记录生成开始时间与耗时，便于统计与排查。"""
    conn.exec_driver_sql("ALTER TABLE assets ADD COLUMN gen_started_at DATETIME")
    conn.exec_driver_sql("ALTER TABLE assets ADD COLUMN gen_elapsed_ms INTEGER")


def _migration_007_generation_tasks(conn: Connection) -> None:
    """持久化生成任务，支持刷新页面/多人共享/重启后恢复。"""
    conn.exec_driver_sql(
        """
        CREATE TABLE generation_tasks (
            id INTEGER NOT NULL,
            client_id VARCHAR(64) NOT NULL,
            prompt_id VARCHAR(64),
            project_id INTEGER NOT NULL,
            episode_id INTEGER,
            kind VARCHAR(8) NOT NULL,
            status VARCHAR(16) NOT NULL,
            prompt_excerpt TEXT DEFAULT '' NOT NULL,
            payload JSON NOT NULL,
            asset_ids JSON,
            error TEXT,
            elapsed_ms INTEGER,
            created_at DATETIME NOT NULL,
            started_at DATETIME,
            finished_at DATETIME,
            updated_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES projects (id),
            FOREIGN KEY(episode_id) REFERENCES episodes (id)
        )
        """
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_generation_tasks_client_id ON generation_tasks (client_id)"
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_generation_tasks_prompt_id ON generation_tasks (prompt_id) "
        "WHERE prompt_id IS NOT NULL"
    )
    for index, column in (
        ("ix_generation_tasks_project_id", "project_id"),
        ("ix_generation_tasks_episode_id", "episode_id"),
        ("ix_generation_tasks_status", "status"),
        ("ix_generation_tasks_created_at", "created_at"),
    ):
        conn.exec_driver_sql(
            f"CREATE INDEX {index} ON generation_tasks ({column})"
        )


def _migration_008_agent(conn: Connection) -> None:
    """Agent 会话、上下文消息、SSE 事件、工具账本与任务关注。"""
    conn.exec_driver_sql(
        """
        CREATE TABLE agent_sessions (
            id INTEGER NOT NULL,
            project_id INTEGER NOT NULL,
            title VARCHAR(200) NOT NULL,
            status VARCHAR(20) NOT NULL,
            model VARCHAR(120) DEFAULT '' NOT NULL,
            context_window INTEGER DEFAULT 0 NOT NULL,
            last_seq INTEGER DEFAULT 0 NOT NULL,
            last_message_seq INTEGER DEFAULT 0 NOT NULL,
            turn INTEGER DEFAULT 0 NOT NULL,
            usage JSON,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY(project_id) REFERENCES projects (id)
        )
        """
    )
    for index, column in (
        ("ix_agent_sessions_project_id", "project_id"),
        ("ix_agent_sessions_status", "status"),
        ("ix_agent_sessions_created_at", "created_at"),
        ("ix_agent_sessions_deleted_at", "deleted_at"),
    ):
        conn.exec_driver_sql(f"CREATE INDEX {index} ON agent_sessions ({column})")

    conn.exec_driver_sql(
        """
        CREATE TABLE agent_messages (
            id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            turn INTEGER NOT NULL,
            role VARCHAR(16) NOT NULL,
            content TEXT DEFAULT '' NOT NULL,
            reasoning TEXT DEFAULT '' NOT NULL,
            tool_calls_raw TEXT,
            tool_call_id VARCHAR(80),
            tool_name VARCHAR(64),
            meta JSON,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(session_id) REFERENCES agent_sessions (id)
        )
        """
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_agent_messages_seq ON agent_messages (session_id, seq)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_messages_session_id ON agent_messages (session_id)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_messages_tool_call_id ON agent_messages (tool_call_id)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_messages_created_at ON agent_messages (created_at)"
    )

    conn.exec_driver_sql(
        """
        CREATE TABLE agent_events (
            id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            type VARCHAR(40) NOT NULL,
            data TEXT DEFAULT '' NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(session_id) REFERENCES agent_sessions (id)
        )
        """
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_agent_events_seq ON agent_events (session_id, seq)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_events_session_id ON agent_events (session_id)"
    )
    conn.exec_driver_sql("CREATE INDEX ix_agent_events_type ON agent_events (type)")
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_events_created_at ON agent_events (created_at)"
    )

    conn.exec_driver_sql(
        """
        CREATE TABLE agent_tool_ledger (
            id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            tool_call_id VARCHAR(80) NOT NULL,
            tool_name VARCHAR(64) NOT NULL,
            status VARCHAR(16) NOT NULL,
            result_raw TEXT,
            created_at DATETIME NOT NULL,
            finished_at DATETIME,
            PRIMARY KEY (id),
            FOREIGN KEY(session_id) REFERENCES agent_sessions (id)
        )
        """
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_agent_ledger_call ON agent_tool_ledger (session_id, tool_call_id)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_tool_ledger_session_id ON agent_tool_ledger (session_id)"
    )

    conn.exec_driver_sql(
        """
        CREATE TABLE agent_task_watch (
            id INTEGER NOT NULL,
            session_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            notified_at DATETIME,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(session_id) REFERENCES agent_sessions (id)
        )
        """
    )
    conn.exec_driver_sql(
        "CREATE UNIQUE INDEX ux_agent_task_watch ON agent_task_watch (session_id, task_id)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_task_watch_session_id ON agent_task_watch (session_id)"
    )
    conn.exec_driver_sql(
        "CREATE INDEX ix_agent_task_watch_task_id ON agent_task_watch (task_id)"
    )


def _migration_009_agent_thinking(conn: Connection) -> None:
    """会话级思考策略与强度，默认跟随 provider 默认（auto）。"""
    conn.exec_driver_sql(
        "ALTER TABLE agent_sessions ADD COLUMN thinking VARCHAR(16) NOT NULL DEFAULT 'auto'"
    )
    conn.exec_driver_sql(
        "ALTER TABLE agent_sessions ADD COLUMN reasoning_effort VARCHAR(16) NOT NULL DEFAULT 'high'"
    )


MIGRATIONS: list[tuple[int, object]] = [
    (1, _migration_001_initial),
    (2, _migration_002_drop_project_status),
    (3, _migration_003_project_sort_index),
    (4, _migration_004_assets),
    (5, _migration_005_episodes),
    (6, _migration_006_generation_stats),
    (7, _migration_007_generation_tasks),
    (8, _migration_008_agent),
    (9, _migration_009_agent_thinking),
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

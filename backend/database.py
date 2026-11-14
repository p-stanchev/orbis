import sqlite3
from datetime import datetime, timezone
from pathlib import Path

DATABASE_PATH = Path(__file__).resolve().parent.parent / "data" / "orbis.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                arrival_utc TEXT,
                duration_hours INTEGER NOT NULL DEFAULT 336
                    CHECK(duration_hours BETWEEN 1 AND 8760)
            )
        """)

        connection.execute("""
            CREATE TABLE IF NOT EXISTS landing_sites (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                name TEXT NOT NULL COLLATE NOCASE,
                latitude REAL NOT NULL DEFAULT -89.5
                    CHECK(latitude BETWEEN -90 AND 90),
                longitude REAL NOT NULL DEFAULT 0
                    CHECK(longitude BETWEEN -180 AND 180),
                FOREIGN KEY (project_id)
                    REFERENCES projects(id)
                    ON DELETE CASCADE,
                UNIQUE (project_id, name)
            )
        """)

        existing = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(projects)")
        }

        if "arrival_utc" not in existing:
            connection.execute("ALTER TABLE projects ADD COLUMN arrival_utc TEXT")
        if "duration_hours" not in existing:
            connection.execute(
                "ALTER TABLE projects ADD COLUMN duration_hours INTEGER NOT NULL DEFAULT 336"
            )

        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        connection.execute(
            "UPDATE projects SET arrival_utc = ? WHERE arrival_utc IS NULL",
            (now,),
        )

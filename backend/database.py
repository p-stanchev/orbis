import sqlite3
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
                name TEXT NOT NULL UNIQUE COLLATE NOCASE
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

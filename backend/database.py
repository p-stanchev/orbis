import sqlite3
import hashlib
import colorsys
from datetime import datetime, timezone
from pathlib import Path

DATABASE_PATH = Path(__file__).resolve().parent.parent / "data" / "orbis.db"


def get_connection():
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def unique_project_color(connection, project_id: str) -> str:
    """Allocate a readable, persistent hex color; never duplicate an active project."""
    used = {row["color"] for row in connection.execute(
        "SELECT color FROM projects WHERE color IS NOT NULL"
    )}
    for attempt in range(5000):
        digest = hashlib.sha256(f"{project_id}:{attempt}".encode()).digest()
        hue = (int.from_bytes(digest[:4], "big") % 3600) / 3600
        saturation = 0.64 + (digest[4] % 12) / 100
        lightness = 0.57 + (digest[5] % 10) / 100
        r, g, b = colorsys.hls_to_rgb(hue, lightness, saturation)
        color = f"#{round(r * 255):02X}{round(g * 255):02X}{round(b * 255):02X}"
        if color not in used:
            return color
    raise RuntimeError("No available project color")


def initialize_database():
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        connection.execute("""
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                arrival_utc TEXT,
                duration_hours INTEGER NOT NULL DEFAULT 336
                    CHECK(duration_hours BETWEEN 1 AND 8760),
                color TEXT UNIQUE,
                center_latitude REAL NOT NULL DEFAULT -89.5,
                center_longitude REAL NOT NULL DEFAULT 0,
                radius_m REAL NOT NULL DEFAULT 500
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

        if "color" not in existing:
            connection.execute("ALTER TABLE projects ADD COLUMN color TEXT")
        if "center_latitude" not in existing:
            connection.execute("ALTER TABLE projects ADD COLUMN center_latitude REAL NOT NULL DEFAULT -89.5")
        if "center_longitude" not in existing:
            connection.execute("ALTER TABLE projects ADD COLUMN center_longitude REAL NOT NULL DEFAULT 0")
        if "radius_m" not in existing:
            connection.execute("ALTER TABLE projects ADD COLUMN radius_m REAL NOT NULL DEFAULT 500")

        for row in connection.execute("SELECT id FROM projects WHERE color IS NULL ORDER BY rowid").fetchall():
            color = unique_project_color(connection, row["id"])
            connection.execute("UPDATE projects SET color = ? WHERE id = ?", (color, row["id"]))
        connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_projects_color ON projects(color)")

        now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
        connection.execute(
            "UPDATE projects SET arrival_utc = ? WHERE arrival_utc IS NULL",
            (now,),
        )

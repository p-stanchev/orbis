import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from inspect import isawaitable
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator

from database import get_connection, initialize_database
from realtime import manager
from terrain import router as terrain_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="ORBIS API", lifespan=lifespan)
app.include_router(terrain_router)


def utc_string(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


class NameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty")
        return value


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    arrival_utc: datetime | None = None
    duration_hours: int | None = Field(default=None, ge=1, le=8760)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty")
        return value

    @field_validator("arrival_utc")
    @classmethod
    def require_timezone(cls, value: datetime | None) -> datetime | None:
        if value is not None and (value.tzinfo is None or value.utcoffset() is None):
            raise ValueError("Arrival time must contain a timezone (UTC recommended)")
        return value


class SiteUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=100)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("Name cannot be empty")
        return value


def site_data(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
    }


def get_project(project_id: str):
    with get_connection() as connection:
        project = connection.execute(
            "SELECT * FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        if project is None:
            raise HTTPException(404, "Project not found")
        sites = connection.execute(
            "SELECT * FROM landing_sites WHERE project_id = ? ORDER BY rowid",
            (project_id,),
        ).fetchall()
    return {
        "id": project["id"],
        "name": project["name"],
        "arrival_utc": project["arrival_utc"],
        "duration_hours": project["duration_hours"],
        "sites": [site_data(site) for site in sites],
    }


def get_site(project_id: str, site_id: str):
    with get_connection() as connection:
        site = connection.execute(
            "SELECT * FROM landing_sites WHERE id = ? AND project_id = ?",
            (site_id, project_id),
        ).fetchone()
    if site is None:
        raise HTTPException(404, "Landing site not found")
    return site_data(site)


async def broadcast_presence():
    for client in tuple(manager.connections):
        try:
            await client.send_json({
                "type": "users_changed",
                "data": {"count": len(manager.connections)},
            })
        except Exception:
            result = manager.disconnect(client)
            if isawaitable(result):
                await result


@app.get("/api/status")
def status():
    return {"status": "online", "service": "orbis"}


@app.get("/api/projects")
def list_projects():
    with get_connection() as connection:
        projects = connection.execute(
            "SELECT id FROM projects ORDER BY rowid"
        ).fetchall()
    return [get_project(row["id"]) for row in projects]


@app.post("/api/projects", status_code=201)
async def create_project(data: NameRequest):
    project_id = str(uuid4())
    now = utc_string(datetime.now(timezone.utc))
    try:
        with get_connection() as connection:
            connection.execute(
                "INSERT INTO projects (id, name, arrival_utc, duration_hours) VALUES (?, ?, ?, ?)",
                (project_id, data.name, now, 336),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Project name already exists")
    result = get_project(project_id)
    await manager.broadcast("projects_changed")
    return result


@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate):
    get_project(project_id)
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Fields cannot be null")
    if not changes:
        return get_project(project_id)
    if "arrival_utc" in changes:
        changes["arrival_utc"] = utc_string(changes["arrival_utc"])

    columns = ", ".join(f"{key} = ?" for key in changes)
    try:
        with get_connection() as connection:
            connection.execute(
                f"UPDATE projects SET {columns} WHERE id = ?",
                [*changes.values(), project_id],
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Invalid or duplicate project data")

    result = get_project(project_id)
    await manager.broadcast("projects_changed")
    return result


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    get_project(project_id)
    with get_connection() as connection:
        connection.execute("DELETE FROM projects WHERE id = ?", (project_id,))
    await manager.broadcast("projects_changed")
    return {"status": "deleted"}


@app.post("/api/projects/{project_id}/sites", status_code=201)
async def create_site(project_id: str, data: NameRequest):
    get_project(project_id)
    site_id = str(uuid4())
    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO landing_sites
                    (id, project_id, name, latitude, longitude)
                VALUES (?, ?, ?, ?, ?)
                """,
                (site_id, project_id, data.name, -89.5, 0.0),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Landing site name already exists")
    result = get_site(project_id, site_id)
    await manager.broadcast("projects_changed")
    return result


@app.patch("/api/projects/{project_id}/sites/{site_id}")
async def update_site(project_id: str, site_id: str, data: SiteUpdate):
    get_site(project_id, site_id)
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Fields cannot be null")
    if not changes:
        return get_site(project_id, site_id)

    columns = ", ".join(f"{key} = ?" for key in changes)
    values = [*changes.values(), site_id, project_id]
    try:
        with get_connection() as connection:
            connection.execute(
                f"UPDATE landing_sites SET {columns} WHERE id = ? AND project_id = ?",
                values,
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Invalid or duplicate landing site data")
    result = get_site(project_id, site_id)
    await manager.broadcast("projects_changed")
    return result


@app.delete("/api/projects/{project_id}/sites/{site_id}")
async def delete_site(project_id: str, site_id: str):
    get_site(project_id, site_id)
    with get_connection() as connection:
        connection.execute(
            "DELETE FROM landing_sites WHERE id = ? AND project_id = ?",
            (site_id, project_id),
        )
    await manager.broadcast("projects_changed")
    return {"status": "deleted"}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    await broadcast_presence()
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        result = manager.disconnect(websocket)
        if isawaitable(result):
            await result
        await broadcast_presence()

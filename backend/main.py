import sqlite3
import math
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from inspect import isawaitable
from uuid import uuid4

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field, field_validator

from database import get_connection, initialize_database, unique_project_color
from realtime import manager
from terrain import router as terrain_router
from ephemeris import router as ephemeris_router
from visibility import router as visibility_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    initialize_database()
    yield


app = FastAPI(title="ORBIS API", lifespan=lifespan)
app.include_router(terrain_router)
app.include_router(ephemeris_router)
app.include_router(visibility_router)


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
    center_latitude: float | None = Field(default=None, ge=-90, le=-80)
    center_longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float | None = Field(default=None, ge=50, le=20000)

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
        "color": project["color"],
        "center_latitude": project["center_latitude"],
        "center_longitude": project["center_longitude"],
        "radius_m": project["radius_m"],
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


def distance_m(lat_a: float, lon_a: float, lat_b: float, lon_b: float) -> float:
    a, b = math.radians(lat_a), math.radians(lat_b)
    delta_lon = math.radians(lon_b - lon_a)
    angle = math.atan2(
        math.hypot(math.cos(b) * math.sin(delta_lon),
                   math.cos(a) * math.sin(b) - math.sin(a) * math.cos(b) * math.cos(delta_lon)),
        math.sin(a) * math.sin(b) + math.cos(a) * math.cos(b) * math.cos(delta_lon),
    )
    return 1_737_400 * angle


def translated_site(old_lat: float, old_lon: float, new_lat: float, new_lon: float,
                    site_lat: float, site_lon: float) -> tuple[float, float]:
    a, b = math.radians(old_lat), math.radians(site_lat)
    delta_lon = math.radians(site_lon - old_lon)
    bearing = math.atan2(math.sin(delta_lon) * math.cos(b),
                         math.cos(a) * math.sin(b) - math.sin(a) * math.cos(b) * math.cos(delta_lon))
    arc = distance_m(old_lat, old_lon, site_lat, site_lon) / 1_737_400
    c = math.radians(new_lat)
    latitude = math.asin(math.sin(c) * math.cos(arc) + math.cos(c) * math.sin(arc) * math.cos(bearing))
    longitude = math.radians(new_lon) + math.atan2(math.sin(bearing) * math.sin(arc) * math.cos(c),
                                                     math.cos(arc) - math.sin(c) * math.sin(latitude))
    return math.degrees(latitude), (math.degrees(longitude) + 180) % 360 - 180


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
            color = unique_project_color(connection, project_id)
            connection.execute(
                "INSERT INTO projects (id, name, arrival_utc, duration_hours, color) VALUES (?, ?, ?, ?, ?)",
                (project_id, data.name, now, 336, color),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Project name already exists")
    result = get_project(project_id)
    await manager.broadcast("projects_changed")
    return result


@app.patch("/api/projects/{project_id}")
async def update_project(project_id: str, data: ProjectUpdate):
    project = get_project(project_id)
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Fields cannot be null")
    if not changes:
        return get_project(project_id)
    if "arrival_utc" in changes:
        changes["arrival_utc"] = utc_string(changes["arrival_utc"])

    center_lat = changes.get("center_latitude", project["center_latitude"])
    center_lon = changes.get("center_longitude", project["center_longitude"])
    radius = changes.get("radius_m", project["radius_m"])
    moving_center = center_lat != project["center_latitude"] or center_lon != project["center_longitude"]
    moved_sites = [(site["id"], *translated_site(project["center_latitude"], project["center_longitude"],
                                                 center_lat, center_lon, site["latitude"], site["longitude"]))
                   for site in project["sites"]] if moving_center else [
                       (site["id"], site["latitude"], site["longitude"]) for site in project["sites"]]
    if any(distance_m(center_lat, center_lon, lat, lon) > radius + 0.5 for _, lat, lon in moved_sites):
        raise HTTPException(422, "Search radius cannot exclude existing landing sites")
    if any(lat < -90 or lat > -80 for _, lat, _ in moved_sites):
        raise HTTPException(422, "Moving this search center would place a site outside map coverage")

    columns = ", ".join(f"{key} = ?" for key in changes)
    try:
        with get_connection() as connection:
            connection.execute(
                f"UPDATE projects SET {columns} WHERE id = ?",
                [*changes.values(), project_id],
            )
            if moving_center:
                connection.executemany("UPDATE landing_sites SET latitude = ?, longitude = ? WHERE id = ?",
                                       [(lat, lon, site_id) for site_id, lat, lon in moved_sites])
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
    project = get_project(project_id)
    site_id = str(uuid4())
    try:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO landing_sites
                    (id, project_id, name, latitude, longitude)
                VALUES (?, ?, ?, ?, ?)
                """,
                (site_id, project_id, data.name, project["center_latitude"], project["center_longitude"]),
            )
    except sqlite3.IntegrityError:
        raise HTTPException(409, "Landing site name already exists")
    result = get_site(project_id, site_id)
    await manager.broadcast("projects_changed")
    return result


@app.patch("/api/projects/{project_id}/sites/{site_id}")
async def update_site(project_id: str, site_id: str, data: SiteUpdate):
    site = get_site(project_id, site_id)
    project = get_project(project_id)
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise HTTPException(422, "Fields cannot be null")
    if not changes:
        return get_site(project_id, site_id)

    latitude = changes.get("latitude", site["latitude"])
    longitude = changes.get("longitude", site["longitude"])
    if distance_m(project["center_latitude"], project["center_longitude"], latitude, longitude) > project["radius_m"] + 0.5:
        raise HTTPException(422, "Landing site must stay inside the project search radius")

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

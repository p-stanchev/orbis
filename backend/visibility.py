from __future__ import annotations

import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import RLock
from uuid import uuid4

import spiceypy as spice
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator
from spiceypy.utils.exceptions import SpiceyError

from ephemeris import _lock as spice_lock, direction, load_kernels
from terrain import horizon_at, terrain_horizon, terrain_horizons

router = APIRouter(prefix="/api/visibility", tags=["Visibility"])
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="orbis-visibility")
_jobs: dict[str, dict] = {}
_keys: dict[tuple, str] = {}
_jobs_lock = RLock()


class VisibilityRequest(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    arrival_utc: datetime
    duration_hours: float = Field(gt=0, le=8760)
    recalculate: bool = False

    @field_validator("arrival_utc")
    @classmethod
    def timezone_required(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("Arrival time must include an offset or Z")
        return value.astimezone(timezone.utc)


class RegionRequest(VisibilityRequest):
    radius_m: float = Field(ge=50, le=20000)
    sun_weight: int = Field(default=70, ge=0, le=100)
    max_no_sun_hours: float | None = Field(default=None, ge=0, le=8760)
    max_no_earth_hours: float | None = Field(default=None, ge=0, le=8760)
    min_daily_earth_hours: float = Field(default=0, ge=0, le=24)
    min_area_km2: float = Field(default=4, ge=0.001, le=1000)


def timestamp_text(value: datetime) -> str:
    return value.isoformat(timespec="seconds").replace("+00:00", "Z")


def ephemeris_values(utc: datetime, lat: float, lon: float) -> dict:
    """SPICE is global state: lock around load/ET/position operations."""
    with spice_lock:
        load_kernels()
        et = spice.utc2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f"))
        return {
            "sun": direction("SUN", et, lat, lon),
            "earth": direction("EARTH", et, lat, lon),
        }


def visible(value: dict, horizon: tuple[float, ...]) -> bool:
    return value["elevation_deg"] + value["angular_radius_deg"] > horizon_at(horizon, value["azimuth_deg"])


def summarize_segments(segments: list[dict], start: datetime, end: datetime) -> dict:
    visible_hours = sum(segment["hours"] for segment in segments)
    gaps = []
    previous = start
    for segment in segments:
        opening = datetime.fromisoformat(segment["start_utc"].replace("Z", "+00:00"))
        closing = datetime.fromisoformat(segment["end_utc"].replace("Z", "+00:00"))
        gaps.append((opening - previous).total_seconds() / 3600)
        previous = closing
    gaps.append((end - previous).total_seconds() / 3600)
    duration = (end - start).total_seconds() / 3600
    return {"windows": segments, "visible_hours": round(visible_hours, 2),
            "visible_percent": round(100 * visible_hours / duration, 2),
            "longest_hidden_hours": round(max(gaps, default=0), 2),
            "window_count": len(segments)}


def joint_windows(sun: dict, earth: dict, start: datetime, end: datetime) -> dict:
    segments = []
    for a in sun["windows"]:
        for b in earth["windows"]:
            opening = max(a["start_utc"], b["start_utc"])
            closing = min(a["end_utc"], b["end_utc"])
            if opening < closing:
                first = datetime.fromisoformat(opening.replace("Z", "+00:00"))
                last = datetime.fromisoformat(closing.replace("Z", "+00:00"))
                segments.append({"start_utc": opening, "end_utc": closing,
                                 "hours": round((last - first).total_seconds() / 3600, 3)})
    segments.sort(key=lambda item: item["start_utc"])
    return summarize_segments(segments, start, end)


def timeline_for(sun: dict, earth: dict, start: datetime, end: datetime) -> list[dict]:
    boundaries = {timestamp_text(start), timestamp_text(end)}
    for body in (sun, earth):
        for segment in body["windows"]:
            boundaries.add(segment["start_utc"])
            boundaries.add(segment["end_utc"])
    ordered = sorted(boundaries)
    timeline = []
    for first, last in zip(ordered, ordered[1:]):
        if first == last:
            continue
        middle = datetime.fromisoformat(first.replace("Z", "+00:00")) + (
            datetime.fromisoformat(last.replace("Z", "+00:00")) -
            datetime.fromisoformat(first.replace("Z", "+00:00"))) / 2
        midpoint = timestamp_text(middle)
        state = {kind: any(window["start_utc"] <= midpoint < window["end_utc"]
                           for window in body["windows"])
                 for kind, body in (("sun", sun), ("earth", earth))}
        hours = (datetime.fromisoformat(last.replace("Z", "+00:00")) -
                 datetime.fromisoformat(first.replace("Z", "+00:00"))).total_seconds() / 3600
        timeline.append({"start_utc": first, "end_utc": last, "hours": round(hours, 2), **state})
    return timeline


def windows_for(samples: list[tuple[datetime, dict]], kind: str, lat: float, lon: float,
                horizon: tuple[float, ...]) -> dict:
    start = samples[0][0]
    end = samples[-1][0]
    segments: list[dict] = []
    is_visible = lambda v: visible(v, horizon)

    def refine(a: datetime, b: datetime, left_is_visible: bool) -> datetime:
        for _ in range(15):  # typically under 1 minute for an hourly bracket
            middle = a + (b - a) / 2
            visible = is_visible(ephemeris_values(middle, lat, lon)[kind])
            if visible == left_is_visible:
                a = middle
            else:
                b = middle
        return a + (b - a) / 2

    active_since = start if is_visible(samples[0][1][kind]) else None
    for (t0, v0), (t1, v1) in zip(samples, samples[1:]):
        was = is_visible(v0[kind]); now = is_visible(v1[kind])
        if was != now:
            crossing = refine(t0, t1, was)
            if now:
                active_since = crossing
            else:
                if active_since is not None:
                    segments.append({"start_utc": timestamp_text(active_since),
                                     "end_utc": timestamp_text(crossing),
                                     "hours": round((crossing - active_since).total_seconds() / 3600, 3)})
                active_since = None
    if active_since is not None:
        segments.append({"start_utc": timestamp_text(active_since),
                         "end_utc": timestamp_text(end),
                         "hours": round((end - active_since).total_seconds() / 3600, 3)})

    return summarize_segments(segments, start, end)


def compute(job_id: str, data: VisibilityRequest) -> None:
    try:
        start = data.arrival_utc
        duration = data.duration_hours
        horizon = terrain_horizon(round(data.latitude, 6), round(data.longitude, 6))
        interval = min(0.25, max(1 / 12, duration / 4000))
        steps = max(1, math.ceil(duration / interval))
        samples = []
        for i in range(steps + 1):
            utc = start + timedelta(hours=duration * i / steps)
            samples.append((utc, ephemeris_values(utc, data.latitude, data.longitude)))
            if i % 20 == 0 or i == steps:
                with _jobs_lock:
                    _jobs[job_id]["progress"] = round(0.9 * i / steps, 3)

        sun = windows_for(samples, "sun", data.latitude, data.longitude, horizon)
        earth = windows_for(samples, "earth", data.latitude, data.longitude, horizon)
        both = joint_windows(sun, earth, start, start + timedelta(hours=duration))
        result = {
            "model": "80 m DEM terrain horizon up to 100 km; any visible part of the Sun or Earth disk",
            "terrain_horizon_applied": True,
            "ground_station_applied": False,
            "power_model_applied": False,
            "sample_step_minutes": round((duration / steps) * 60, 2),
            "start_utc": timestamp_text(start),
            "end_utc": timestamp_text(start + timedelta(hours=duration)),
            "sun": sun,
            "earth": earth,
            "both": both,
            "timeline": timeline_for(sun, earth, start, start + timedelta(hours=duration)),
        }
        with _jobs_lock:
            _jobs[job_id].update(status="completed", progress=1.0, result=result)
    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id].update(status="failed", error=str(exc))


def compute_region(job_id: str, data: RegionRequest) -> None:
    try:
        spacing = max(100.0, data.radius_m / 20)
        extent = math.ceil(data.radius_m / spacing)
        origin_lat = math.radians(data.latitude)
        origin_lon = math.radians(data.longitude)
        cells = []
        outside_coverage = 0
        positions = []
        for row in range(-extent, extent + 1):
            for col in range(-extent, extent + 1):
                east, north = col * spacing, row * spacing
                distance = math.hypot(east, north)
                if distance > data.radius_m:
                    continue
                arc = distance / 1737400.0
                bearing = math.atan2(east, north)
                lat = math.asin(math.sin(origin_lat) * math.cos(arc) +
                                math.cos(origin_lat) * math.sin(arc) * math.cos(bearing))
                lon = origin_lon + math.atan2(math.sin(bearing) * math.sin(arc) * math.cos(origin_lat),
                                               math.cos(arc) - math.sin(origin_lat) * math.sin(lat))
                lat_deg = math.degrees(lat)
                if lat_deg > -80 or lat_deg < -90:
                    outside_coverage += 1
                    continue
                positions.append((lat_deg, (math.degrees(lon) + 180) % 360 - 180))
                cells.append((row, col))
        if not positions:
            raise ValueError("No DEM-covered cells in this search radius")
        horizon = terrain_horizons(positions)
        with _jobs_lock:
            _jobs[job_id]["progress"] = 0.25
        latitudes = np.deg2rad(np.array([point[0] for point in positions]))
        longitudes = np.deg2rad(np.array([point[1] for point in positions]))
        up = np.stack((np.cos(latitudes) * np.cos(longitudes),
                       np.cos(latitudes) * np.sin(longitudes), np.sin(latitudes)), axis=1)
        east = np.stack((-np.sin(longitudes), np.cos(longitudes), np.zeros(len(positions))), axis=1)
        north = np.stack((-np.sin(latitudes) * np.cos(longitudes),
                          -np.sin(latitudes) * np.sin(longitudes), np.cos(latitudes)), axis=1)
        counts = {"sun": np.zeros(len(positions)), "earth": np.zeros(len(positions))}
        streak = {"sun": np.zeros(len(positions)), "earth": np.zeros(len(positions))}
        longest = {"sun": np.zeros(len(positions)), "earth": np.zeros(len(positions))}
        day_count = math.ceil(data.duration_hours / 24)
        daily_earth = np.zeros((day_count, len(positions)))
        steps = max(1, math.ceil(data.duration_hours / 2))
        step_hours = data.duration_hours / steps
        for step in range(steps):
            utc = data.arrival_utc + timedelta(hours=data.duration_hours * (step + 0.5) / steps)
            with spice_lock:
                load_kernels()
                et = spice.utc2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f"))
                vectors = {kind: spice.spkpos(kind.upper(), et, "MOON_ME", "LT+S", "MOON")[0]
                           for kind in counts}
            for kind, xyz in vectors.items():
                topocentric = np.asarray(xyz)[None, :] - 1737.4 * up
                length = np.linalg.norm(topocentric, axis=1)
                ray = topocentric / length[:, None]
                altitude = np.rad2deg(np.arcsin(np.clip(np.sum(ray * up, axis=1), -1, 1)))
                azimuth = np.rad2deg(np.arctan2(np.sum(ray * east, axis=1),
                                                np.sum(ray * north, axis=1))) % 360
                index = azimuth / 2
                lower = np.floor(index).astype(int) % 180
                fraction = index - np.floor(index)
                obstruction = horizon[np.arange(len(positions)), lower] * (1 - fraction) + \
                    horizon[np.arange(len(positions)), (lower + 1) % 180] * fraction
                radius_km = 695700.0 if kind == "sun" else 6378.137
                angular_radius = np.rad2deg(np.arcsin(np.clip(radius_km / length, 0, 1)))
                seen = altitude + angular_radius > obstruction
                counts[kind] += seen
                streak[kind] = np.where(seen, 0, streak[kind] + step_hours)
                longest[kind] = np.maximum(longest[kind], streak[kind])
                if kind == "earth":
                    day = min(day_count - 1, int((step + 0.5) * step_hours / 24))
                    daily_earth[day] += seen * step_hours
            if step % 10 == 0 or step == steps - 1:
                with _jobs_lock:
                    _jobs[job_id]["progress"] = round(0.25 + 0.7 * (step + 1) / steps, 3)
        sun = 100 * counts["sun"] / steps
        earth = 100 * counts["earth"] / steps
        score = (data.sun_weight * sun + (100 - data.sun_weight) * earth) / 100
        day_lengths = np.array([min(24, data.duration_hours - day * 24) for day in range(day_count)])
        daily_equivalent = daily_earth / day_lengths[:, None] * 24
        least_daily_earth = np.min(daily_equivalent, axis=0)
        eligible = np.ones(len(positions), dtype=bool)
        if data.max_no_sun_hours is not None:
            eligible &= longest["sun"] <= data.max_no_sun_hours
        if data.max_no_earth_hours is not None:
            eligible &= longest["earth"] <= data.max_no_earth_hours
        eligible &= least_daily_earth >= data.min_daily_earth_hours
        eligible &= np.all(np.isfinite(horizon), axis=1)
        mission_needs = (data.max_no_sun_hours is not None or data.max_no_earth_hours is not None
                         or data.min_daily_earth_hours > 0)
        if mission_needs:
            near = np.ones(len(positions), dtype=bool)
            if data.max_no_sun_hours is not None:
                near &= longest["sun"] <= data.max_no_sun_hours + max(step_hours, data.max_no_sun_hours * 0.2)
            if data.max_no_earth_hours is not None:
                near &= longest["earth"] <= data.max_no_earth_hours + max(step_hours, data.max_no_earth_hours * 0.2)
            if data.min_daily_earth_hours > 0:
                near &= least_daily_earth >= data.min_daily_earth_hours * 0.8
            bands = np.where(eligible, "green", np.where(near, "yellow", "red"))
        else:
            bands = np.where(score >= 70, "green", np.where(score >= 35, "yellow", "red"))
        lookup = {cell: index for index, cell in enumerate(cells)}
        covered = np.all(np.isfinite(horizon), axis=1)
        cell_area = spacing ** 2 / 1_000_000
        side = max(2, math.ceil(math.sqrt(data.min_area_km2 / cell_area)))
        proposals = []
        for row, col in cells:
            group = [lookup.get((row + dr, col + dc)) for dr in range(side) for dc in range(side)]
            if any(index is None or not covered[index] for index in group):
                continue
            quality = float(np.percentile(score[group], 25))
            meeting = float(np.mean(eligible[group])) if mission_needs else 1.0
            proposals.append((meeting, quality, float(np.mean(score[group])), group))
        proposals.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
        regions = []
        used = set()
        for meeting, quality, average, group in proposals:
            if len(regions) >= 8:
                break
            if any(index in used for index in group):
                continue
            used.update(group)
            representative = max(group, key=lambda index: (eligible[index], score[index]))
            area = len(group) * cell_area
            band = ("green" if meeting >= 0.75 else "yellow" if meeting >= 0.25 else "red") if mission_needs else \
                ("green" if quality >= 70 else "yellow" if quality >= 35 else "red")
            regions.append({"area_km2": round(area, 2), "score": round(average, 1),
                            "robust_score": round(quality, 1),
                            "band": band, "meeting_percent": round(meeting * 100, 1) if mission_needs else None,
                            "sun_percent": round(float(np.mean(sun[group])), 1),
                            "earth_percent": round(float(np.mean(earth[group])), 1),
                            "average_no_sun_hours": round(float(np.mean(longest["sun"][group])), 1),
                            "average_no_earth_hours": round(float(np.mean(longest["earth"][group])), 1),
                            "average_daily_earth_hours": round(float(np.mean(least_daily_earth[group])), 1),
                            "longest_no_sun_hours": round(float(np.max(longest["sun"][group])), 1),
                            "longest_no_earth_hours": round(float(np.max(longest["earth"][group])), 1),
                            "least_daily_earth_hours": round(float(np.min(least_daily_earth[group])), 1),
                            "sun_range": [round(float(np.min(sun[group])), 1), round(float(np.max(sun[group])), 1)],
                            "earth_range": [round(float(np.min(earth[group])), 1), round(float(np.max(earth[group])), 1)],
                            "center_latitude": round(float(np.mean([positions[i][0] for i in group])), 6),
                            "center_longitude": round(float(np.mean([positions[i][1] for i in group])), 6),
                            "representative_latitude": round(positions[representative][0], 6),
                            "representative_longitude": round(positions[representative][1], 6),
                            "cells": [{"latitude": round(positions[i][0], 6),
                                       "longitude": round(positions[i][1], 6),
                                       "score": round(float(score[i]), 1)} for i in group]})
        displayed = regions
        recommended = {(cell["latitude"], cell["longitude"])
                       for region in displayed for cell in region["cells"]}
        grid = [{"latitude": round(lat, 6), "longitude": round(lon, 6),
                 "score": round(float(score[index]), 1) if np.isfinite(horizon[index]).all() else None,
                 "band": str(bands[index]),
                 "status": "no_data" if not np.isfinite(horizon[index]).all() else
                           "below_minimum" if not eligible[index] else
                           "recommended" if (round(lat, 6), round(lon, 6)) in recommended else "evaluated"}
                for index, (lat, lon) in enumerate(positions)]
        with _jobs_lock:
            _jobs[job_id].update(status="completed", progress=1.0,
                                 result={"regions": displayed, "grid": grid, "sample_count": steps,
                                         "grid_spacing_m": spacing, "evaluated_cells": len(positions),
                                         "outside_coverage_cells": outside_coverage,
                                         "color_mode": "mission_needs" if mission_needs else "relative_visibility",
                                         "model": "Nonoverlapping sampled patches ranked by limits met and lower-quartile visibility; 80 m DEM horizon"})
    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id].update(status="failed", error=str(exc))


@router.post("/regions/jobs", status_code=202)
def start_region(data: RegionRequest):
    key = ("region", round(data.latitude, 6), round(data.longitude, 6),
           round(data.radius_m, 1), timestamp_text(data.arrival_utc),
           round(data.duration_hours, 4), data.sun_weight, data.max_no_sun_hours,
           data.max_no_earth_hours, data.min_daily_earth_hours, data.min_area_km2, "regions-v6")
    with _jobs_lock:
        existing = _keys.get(key)
        if not data.recalculate and existing and existing in _jobs and _jobs[existing]["status"] != "failed":
            return {"id": existing, "status": _jobs[existing]["status"]}
        job_id = str(uuid4())
        _keys[key] = job_id
        _jobs[job_id] = {"id": job_id, "status": "running", "progress": 0.0,
                         "result": None, "error": None}
    executor.submit(compute_region, job_id, data)
    return {"id": job_id, "status": "running"}


@router.post("/jobs", status_code=202)
def start_visibility(data: VisibilityRequest):
    key = (round(data.latitude, 6), round(data.longitude, 6),
           timestamp_text(data.arrival_utc), round(data.duration_hours, 4), "terrain-v4")
    with _jobs_lock:
        existing_id = _keys.get(key)
        if not data.recalculate and existing_id and existing_id in _jobs and _jobs[existing_id]["status"] != "failed":
            return {"id": existing_id, "status": _jobs[existing_id]["status"]}
        if len(_jobs) > 128:
            old_ids = list(_jobs)[:32]
            for old_id in old_ids:
                if _jobs[old_id]["status"] != "running":
                    del _jobs[old_id]
        job_id = str(uuid4())
        _keys[key] = job_id
        _jobs[job_id] = {"id": job_id, "status": "running", "progress": 0.0,
                         "result": None, "error": None}
    executor.submit(compute, job_id, data)
    return {"id": job_id, "status": "running"}


@router.get("/jobs/{job_id}")
def get_visibility_job(job_id: str):
    with _jobs_lock:
        if job_id not in _jobs:
            raise HTTPException(status_code=404, detail="Visibility job not found")
        return _jobs[job_id].copy()

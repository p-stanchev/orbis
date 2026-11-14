import math
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock

import spiceypy as spice
from fastapi import APIRouter, HTTPException, Query
from spiceypy.utils.exceptions import SpiceyError
from terrain import horizon_at, terrain_horizon

router = APIRouter(prefix="/api/ephemeris", tags=["Ephemeris"])

KERNEL_DIR = Path(__file__).resolve().parent.parent / "data" / "kernels"

KERNEL_FILES = (
    "naif0012.tls",
    "de440s.bsp",
    "moon_pa_de440_200625.bpc",
    "moon_de440_250416.tf",
)

MOON_RADIUS_KM = 1737.4

_lock = RLock()
_loaded = False


def load_kernels():
    global _loaded

    if _loaded:
        return

    missing = [
        name
        for name in KERNEL_FILES
        if not (KERNEL_DIR / name).is_file()
    ]

    if missing:
        raise HTTPException(
            status_code=503,
            detail="Download the required SPICE kernel(s): " + ", ".join(missing),
        )

    try:
        for name in KERNEL_FILES:
            spice.furnsh(str(KERNEL_DIR / name))
    except SpiceyError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Could not load SPICE kernels: {exc.short}",
        ) from exc

    _loaded = True


def direction(target: str, et: float, latitude: float, longitude: float):
    xyz, _ = spice.spkpos(target, et, "MOON_ME", "LT+S", "MOON")

    lat = math.radians(latitude)
    lon = math.radians(longitude)

    clat = math.cos(lat)
    slat = math.sin(lat)
    clon = math.cos(lon)
    slon = math.sin(lon)

    up = (
        clat * clon,
        clat * slon,
        slat,
    )

    east = (
        -slon,
        clon,
        0.0,
    )

    north = (
        -slat * clon,
        -slat * slon,
        clat,
    )

    topocentric = [
        xyz[i] - MOON_RADIUS_KM * up[i]
        for i in range(3)
    ]

    length = math.sqrt(
        sum(value * value for value in topocentric)
    )

    ray = [
        value / length
        for value in topocentric
    ]

    altitude = math.degrees(
        math.asin(
            max(
                -1.0,
                min(
                    1.0,
                    sum(ray[i] * up[i] for i in range(3)),
                ),
            )
        )
    )

    azimuth = math.degrees(
        math.atan2(
            sum(ray[i] * east[i] for i in range(3)),
            sum(ray[i] * north[i] for i in range(3)),
        )
    ) % 360

    body_radius_km = 6378.137 if target == "EARTH" else 695700.0
    angular_radius = math.degrees(math.asin(min(1.0, body_radius_km / length)))
    ratio = altitude / angular_radius
    if ratio >= 1:
        visible_fraction = 1.0
    elif ratio <= -1:
        visible_fraction = 0.0
    else:
        visible_fraction = (math.acos(-ratio) + ratio * math.sqrt(1 - ratio * ratio)) / math.pi
    visibility = "full" if visible_fraction >= 0.999999 else (
        "partial" if visible_fraction > 0 else "hidden"
    )

    return {
        "angular_radius_deg": round(angular_radius, 4),
        "geometric_visible_fraction": round(visible_fraction, 6),
        "geometric_visibility": visibility,
        "azimuth_deg": round(azimuth, 4),
        "elevation_deg": round(altitude, 4),
        "above_geometric_horizon": altitude > 0,
    }


@router.get("")
def get_ephemeris(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    time: datetime = Query(
        ...,
        description=(
            "Timezone-aware ISO 8601 date/time, "
            "e.g. 2026-11-16T12:00:00Z"
        ),
    ),
):
    if time.tzinfo is None or time.utcoffset() is None:
        raise HTTPException(
            status_code=422,
            detail="Time must contain a UTC offset or Z",
        )

    utc = time.astimezone(timezone.utc)

    with _lock:
        load_kernels()

        try:
            et = spice.utc2et(utc.strftime("%Y-%m-%dT%H:%M:%S.%f"))

            sun = direction(
                "SUN",
                et,
                latitude,
                longitude,
            )

            earth = direction(
                "EARTH",
                et,
                latitude,
                longitude,
            )

        except SpiceyError as exc:
            raise HTTPException(
                status_code=422,
                detail=f"Ephemeris unavailable for this date: {exc.short}",
            ) from exc

    try:
        horizon = terrain_horizon(round(latitude, 6), round(longitude, 6))
    except (OSError, ValueError, KeyError) as exc:
        raise HTTPException(503, f"Terrain horizon unavailable: {exc}") from exc
    for body in (sun, earth):
        obstruction = horizon_at(horizon, body["azimuth_deg"])
        margin = body["elevation_deg"] - obstruction
        angular_radius = body["angular_radius_deg"]
        ratio = max(-1.0, min(1.0, margin / angular_radius))
        fraction = (math.acos(-ratio) + ratio * math.sqrt(1 - ratio * ratio)) / math.pi
        body["terrain_horizon_deg"] = round(obstruction, 4)
        body["terrain_visible_fraction"] = round(fraction, 6)
        body["terrain_visibility"] = "hidden" if fraction == 0 else "full" if fraction == 1 else "partial"

    return {
        "latitude": latitude,
        "longitude": longitude,
        "time_utc": utc.isoformat().replace("+00:00", "Z"),
        "sun": sun,
        "earth": earth,
        "terrain_horizon_applied": True,
        "reference_frame": "MOON_ME",
        "model": "80 m DEM horizon; terrain sampling up to 100 km",
    }

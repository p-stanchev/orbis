import io
import math
import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from fastapi import APIRouter, HTTPException, Query, Response
from PIL import Image
from pydantic import BaseModel, Field
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import from_bounds
from rasterio.warp import reproject

router = APIRouter(prefix="/api/terrain", tags=["Terrain"])
DATA = Path(__file__).resolve().parent.parent / "data"
SIZE = 2048


def dataset_path(role: str) -> Path:
    config = json.loads((DATA / "datasets.json").read_text(encoding="utf-8"))
    path = DATA / "source" / config[role]["file"]
    if not path.is_file():
        raise FileNotFoundError(f"Missing dataset: {path.name}")
    return path


def elevation_dataset():
    return rasterio.open(dataset_path("elevation"))


@lru_cache(maxsize=128)
def terrain_horizon(latitude: float, longitude: float):
    azimuths = np.arange(0.0, 360.0, 2.0)
    distances = np.geomspace(80.0, 100000.0, 120)
    angles = np.deg2rad(azimuths)[:, None]
    arc = distances[None, :] / 1737400.0
    lat = math.radians(latitude)
    lon = math.radians(longitude)
    destination_lat = np.arcsin(np.sin(lat) * np.cos(arc) + np.cos(lat) * np.sin(arc) * np.cos(angles))
    destination_lon = lon + np.arctan2(
        np.sin(angles) * np.sin(arc) * np.cos(lat),
        np.cos(arc) - np.sin(lat) * np.sin(destination_lat),
    )
    with elevation_dataset() as src:
        forward = Transformer.from_crs(src.crs.geodetic_crs, src.crs, always_xy=True)
        x0, y0 = forward.transform(longitude, latitude)
        x, y = forward.transform(np.rad2deg(destination_lon).ravel(), np.rad2deg(destination_lat).ravel())
        origin = next(src.sample([(x0, y0)], masked=True))[0]
        if np.ma.is_masked(origin) or not np.isfinite(origin):
            raise ValueError("No elevation data at landing site")
        values = np.ma.asarray(list(src.sample(zip(x, y), masked=True)))[:, 0].reshape(len(azimuths), len(distances))
        valid = ~np.ma.getmaskarray(values) & np.isfinite(values.data)
        valid &= np.abs(values.data) < 100000
        if not np.all(np.any(valid, axis=1)):
            raise ValueError("DEM does not cover the full local horizon")
        curvature = distances ** 2 / (2 * 1737400.0)
        slopes = np.arctan2(values.data - float(origin) - curvature[None, :], distances[None, :])
        horizon = np.max(np.where(valid, slopes, -np.inf), axis=1)
        return tuple(float(value) for value in np.rad2deg(horizon))


def horizon_at(horizon: tuple[float, ...], azimuth: float) -> float:
    index = (azimuth % 360) * len(horizon) / 360
    lower = int(index)
    fraction = index - lower
    return horizon[lower % len(horizon)] * (1 - fraction) + horizon[(lower + 1) % len(horizon)] * fraction


def terrain_horizons(locations: list[tuple[float, float]]) -> np.ndarray:
    if not locations:
        return np.empty((0, 180))
    azimuths = np.deg2rad(np.arange(0, 360, 2.0))
    distances = np.geomspace(80.0, 100000.0, 120)
    radius = 1737400.0
    with elevation_dataset() as src:
        forward = Transformer.from_crs(src.crs.geodetic_crs, src.crs, always_xy=True)
        centers_x, centers_y = forward.transform(
            [location[1] for location in locations], [location[0] for location in locations]
        )
        origins = np.ma.asarray(list(src.sample(zip(centers_x, centers_y), masked=True)))[:, 0]
        valid_origins = ~np.ma.getmaskarray(origins) & np.isfinite(origins.data)
        padding = 105000
        window = from_bounds(min(centers_x) - padding, min(centers_y) - padding,
                             max(centers_x) + padding, max(centers_y) + padding, src.transform)
        window = window.round_offsets().round_lengths()
        raster = src.read(1, window=window, boundless=True, masked=True)
        inverse = ~(src.window_transform(window))
        output = np.empty((len(locations), len(azimuths)))
        for start in range(0, len(locations), 12):
            batch = locations[start:start + 12]
            lat = np.deg2rad(np.array([location[0] for location in batch]))[:, None, None]
            lon = np.deg2rad(np.array([location[1] for location in batch]))[:, None, None]
            az = azimuths[None, :, None]
            arc = distances[None, None, :] / radius
            destination_lat = np.arcsin(np.sin(lat) * np.cos(arc) + np.cos(lat) * np.sin(arc) * np.cos(az))
            destination_lon = lon + np.arctan2(np.sin(az) * np.sin(arc) * np.cos(lat),
                                                np.cos(arc) - np.sin(lat) * np.sin(destination_lat))
            x, y = forward.transform(np.rad2deg(destination_lon).ravel(), np.rad2deg(destination_lat).ravel())
            col, row = inverse * (x, y)
            row = np.floor(row).astype(int)
            col = np.floor(col).astype(int)
            inside = (row >= 0) & (row < raster.shape[0]) & (col >= 0) & (col < raster.shape[1])
            row = np.clip(row, 0, raster.shape[0] - 1)
            col = np.clip(col, 0, raster.shape[1] - 1)
            sampled = np.ma.asarray(raster[row, col]).reshape(len(batch), len(azimuths), len(distances))
            valid = inside.reshape(sampled.shape) & ~np.ma.getmaskarray(sampled) & np.isfinite(sampled.data)
            valid &= np.abs(sampled.data) < 100000
            valid &= valid_origins[start:start + len(batch), None, None]
            slopes = np.arctan2(sampled.data - np.asarray(origins[start:start + len(batch)])[:, None, None]
                                 - distances[None, None, :] ** 2 / (2 * radius), distances[None, None, :])
            horizon = np.max(np.where(valid, slopes, -np.inf), axis=2)
            output[start:start + len(batch)] = np.rad2deg(horizon)
    return output


def geometry(src):
    forward = Transformer.from_crs(src.crs.geodetic_crs, src.crs, always_xy=True)
    pole_x, pole_y = forward.transform(0, -90)
    edge_x, edge_y = forward.transform(0, -80)
    radius = float(np.hypot(edge_x - pole_x, edge_y - pole_y))
    bounds = src.bounds
    return bounds, float(pole_x), float(pole_y), radius


def coordinates_in_coverage(x, y, pole_x, pole_y, radius):
    return (x - pole_x) ** 2 + (y - pole_y) ** 2 <= radius ** 2


@router.get("/info")
def terrain_info():
    try:
        with elevation_dataset() as src:
            bounds, px, py, radius = geometry(src)
            return {
                "bounds": {"left": bounds.left, "right": bounds.right,
                           "top": bounds.top, "bottom": bounds.bottom},
                "pole": {"x": px, "y": py},
                "radius": radius,
                "width": src.width,
                "height": src.height,
                "resolution": list(src.res),
                "coverage": "80S-90S",
            }
    except (OSError, KeyError, ValueError) as exc:
        raise HTTPException(503, str(exc)) from exc


@lru_cache(maxsize=2)
def render_layer(layer: str) -> bytes:
    role = "hillshade" if layer == "hillshade" else "permanent_shadows"
    with elevation_dataset() as reference:
        bounds, px, py, radius = geometry(reference)
        output_transform = reference.transform * reference.transform.scale(
            reference.width / SIZE, reference.height / SIZE
        )
        with rasterio.open(dataset_path(role)) as source:
            values = np.full((SIZE, SIZE), -9999, dtype=np.float32)
            reproject(
                source=rasterio.band(source, 1),
                destination=values,
                src_transform=source.transform,
                src_crs=source.crs,
                src_nodata=source.nodata,
                dst_transform=output_transform,
                dst_crs=reference.crs,
                dst_nodata=-9999,
                resampling=Resampling.bilinear if layer == "hillshade" else Resampling.nearest,
            )

        xs = bounds.left + (np.arange(SIZE) + 0.5) * (bounds.right - bounds.left) / SIZE
        ys = bounds.top - (np.arange(SIZE) + 0.5) * (bounds.top - bounds.bottom) / SIZE
        inside = (xs[None, :] - px) ** 2 + (ys[:, None] - py) ** 2 <= radius ** 2
        valid = inside & np.isfinite(values) & (values != -9999)
        pixels = np.zeros((SIZE, SIZE, 4), dtype=np.uint8)

        if layer == "hillshade":
            if valid.any():
                low, high = np.percentile(values[valid], [2, 98])
                high = max(high, low + 1)
                gray = np.clip((values - low) * 255 / (high - low), 0, 255).astype(np.uint8)
                pixels[:, :, :3] = gray[:, :, None]
                pixels[:, :, 3] = np.where(valid, 255, 0).astype(np.uint8)
        else:
            # Positive PSR values are treated as flagged regions; confirm against NASA raster metadata.
            psr = valid & (values > 0)
            pixels[:, :, :3] = (3, 172, 228)
            pixels[:, :, 3] = np.where(psr, 205, 0).astype(np.uint8)

    output = io.BytesIO()
    Image.fromarray(pixels, "RGBA").save(output, format="PNG")
    return output.getvalue()


@router.get("/preview/{layer}")
def terrain_preview(layer: str):
    if layer not in ("hillshade", "shadows"):
        raise HTTPException(404, "Unknown terrain layer")
    try:
        return Response(render_layer(layer), media_type="image/png",
                        headers={"Cache-Control": "no-cache"})
    except (OSError, KeyError, ValueError) as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/coordinates")
def terrain_coordinates(x: float = Query(...), y: float = Query(...)):
    try:
        with elevation_dataset() as src:
            bounds, px, py, radius = geometry(src)
            if not (bounds.left <= x <= bounds.right and bounds.bottom <= y <= bounds.top):
                raise HTTPException(400, "Outside raster bounds")
            if not coordinates_in_coverage(x, y, px, py, radius):
                raise HTTPException(400, "Outside south-pole coverage")
            inverse = Transformer.from_crs(src.crs, src.crs.geodetic_crs, always_xy=True)
            longitude, latitude = inverse.transform(x, y)
            if not (np.isfinite(latitude) and np.isfinite(longitude)):
                raise ValueError("Invalid lunar coordinates")
            return {"latitude": round(float(latitude), 6),
                    "longitude": round(float((longitude + 180) % 360 - 180), 6)}
    except HTTPException:
        raise
    except (OSError, KeyError, ValueError) as exc:
        raise HTTPException(503, str(exc)) from exc


class MapSite(BaseModel):
    id: str
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


@router.post("/project")
def project_sites(sites: list[MapSite]):
    try:
        with elevation_dataset() as src:
            bounds, px, py, radius = geometry(src)
            forward = Transformer.from_crs(src.crs.geodetic_crs, src.crs, always_xy=True)
            result = []
            for site in sites:
                if site.latitude > -80:
                    continue
                x, y = forward.transform(site.longitude, site.latitude)
                if not (np.isfinite(x) and np.isfinite(y)):
                    continue
                if not coordinates_in_coverage(x, y, px, py, radius):
                    continue
                u = (x - bounds.left) / (bounds.right - bounds.left)
                v = (bounds.top - y) / (bounds.top - bounds.bottom)
                if 0 <= u <= 1 and 0 <= v <= 1:
                    result.append({"id": site.id, "u": float(u), "v": float(v)})
            return result
    except (OSError, KeyError, ValueError) as exc:
        raise HTTPException(503, str(exc)) from exc


@router.get("/local-patch")
def local_terrain_patch(
    latitude: float = Query(..., ge=-90, le=-80),
    longitude: float = Query(..., ge=-180, le=180),
    width_m: int = Query(2000, ge=250, le=4000),
):
    """Extract a local 129x129 elevation patch, preferring 5m LOLA where covered.

    Falls back to the lower-resolution south-pole DEM outside the 5m mosaic.
    Output heights are source elevation samples; the viewer exaggerates relief.
    """
    try:
        config = json.loads((DATA / "datasets.json").read_text(encoding="utf-8"))
        candidates = []
        if latitude <= -87 and "high_resolution" in config:
            candidates.append((config["high_resolution"]["elevation"], "5 m"))
        candidates.append((config["elevation"]["file"], "80 m"))

        for filename, nominal_resolution in candidates:
            path = DATA / "source" / filename
            if not path.is_file():
                continue
            with rasterio.open(path) as src:
                forward = Transformer.from_crs(
                    src.crs.geodetic_crs, src.crs, always_xy=True
                )
                x, y = forward.transform(longitude, latitude)
                if not (np.isfinite(x) and np.isfinite(y)):
                    raise HTTPException(422, "Invalid lunar coordinates")
                # Align the 3D patch with the local north/east basis used by SPICE.
                # The TIFF window is projected-grid aligned, not true-north aligned.
                north_x, north_y = forward.transform(
                    longitude, min(-80.0, latitude + 0.0001)
                )
                nx, ny = north_x - x, north_y - y
                north_rotation_deg = math.degrees(math.atan2(nx, ny)) if (nx or ny) else 0.0
                half = width_m / 2
                window = from_bounds(
                    x - half, y - half, x + half, y + half, src.transform
                )
                values = src.read(
                    1,
                    window=window,
                    out_shape=(129, 129),
                    masked=True,
                    boundless=True,
                    resampling=Resampling.bilinear,
                )
                valid = ~np.ma.getmaskarray(values) & np.isfinite(values.data)
                if src.nodata is not None:
                    valid &= values.data != src.nodata
                if np.count_nonzero(valid) < 100:
                    continue
                if not valid[64, 64]:
                    continue
                z = np.where(valid, values.data, np.nan).astype(np.float64)
                return {
                    "width_m": width_m,
                    "grid_size": 129,
                    "elevation": [
                        None if not np.isfinite(v) else round(float(v), 2)
                        for v in z.ravel()
                    ],
                    "coverage_fraction": round(float(np.mean(valid)), 4),
                    "dataset": filename,
                    "resolution": nominal_resolution,
                    "north_rotation_deg": round(north_rotation_deg, 6),
                    "note": "DEM sampled locally; terrain shadows not calculated",
                }
        raise HTTPException(
            503,
            "No usable DEM data for this site. Check data/source and data/datasets.json.",
        )
    except HTTPException:
        raise
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise HTTPException(
            503, f"Could not read local DEM terrain: {exc}"
        ) from exc

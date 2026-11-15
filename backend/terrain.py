import io
import math
import json
from contextlib import ExitStack
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from fastapi import APIRouter, HTTPException, Query, Response
from PIL import Image
from pydantic import BaseModel, Field
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.windows import Window, from_bounds
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


def sample_slope(src, forward, latitude: float, longitude: float, high_resolution: bool):
    x, y = forward.transform(longitude, latitude)
    row, col = src.index(x, y)
    radius = 50 if high_resolution else 400
    pixels = max(1, int(round(radius / max(abs(src.res[0]), abs(src.res[1])))))
    edge = pixels if high_resolution else pixels + 1
    width = 2 * edge + 1
    values = src.read(1, window=Window(col - edge, row - edge, width, width),
                      boundless=True, masked=True)
    offsets = np.arange(-edge, edge + 1)
    footprint = (offsets[:, None] * abs(src.res[1])) ** 2 + \
                (offsets[None, :] * abs(src.res[0])) ** 2 <= radius ** 2
    raw_valid = ~np.ma.getmaskarray(values) & np.isfinite(values.data)
    if high_resolution:
        slopes = values.data
        valid = footprint & raw_valid & (slopes >= 0) & (slopes <= 90)
    else:
        neighbors = np.zeros_like(raw_valid)
        neighbors[1:-1, 1:-1] = (raw_valid[1:-1, 1:-1] & raw_valid[:-2, 1:-1] &
                                raw_valid[2:, 1:-1] & raw_valid[1:-1, :-2] & raw_valid[1:-1, 2:])
        north_gradient, east_gradient = np.gradient(values.data, abs(src.res[1]), abs(src.res[0]))
        slopes = np.rad2deg(np.arctan(np.hypot(north_gradient, east_gradient)))
        valid = footprint & neighbors & np.isfinite(slopes)
    if np.count_nonzero(valid) / np.count_nonzero(footprint) < 0.75:
        return None
    result = {"slope_p90_deg": round(float(np.percentile(slopes[valid], 90)), 1),
              "footprint_radius_m": radius, "resolution_m": 5 if high_resolution else 80,
              "dataset": "LOLA 5 m slope raster" if high_resolution else "LOLA 80 m elevation-derived slope"}
    if not high_resolution:
        surface = footprint & raw_valid
        rows, columns = np.nonzero(surface)
        easting = (columns - edge) * abs(src.res[0])
        northing = (rows - edge) * abs(src.res[1])
        heights = values.data[surface].astype(float)
        plane = np.column_stack((np.ones(len(heights)), easting, northing))
        coefficients = np.linalg.lstsq(plane, heights, rcond=None)[0]
        residual = heights - plane @ coefficients
        result["roughness_rms_m"] = round(float(np.sqrt(np.mean(residual ** 2))), 2)
        result["elevation_m"] = round(float(values.data[edge, edge]), 1) if raw_valid[edge, edge] else None
    return result


def region_slopes(locations: list[tuple[float, float]]):
    config = json.loads((DATA / "datasets.json").read_text(encoding="utf-8"))
    filename = config.get("high_resolution", {}).get("slope")
    path = DATA / "source" / filename if filename else None
    with ExitStack() as stack:
        elevation = stack.enter_context(elevation_dataset())
        elevation_forward = Transformer.from_crs(elevation.crs.geodetic_crs, elevation.crs, always_xy=True)
        high = stack.enter_context(rasterio.open(path)) if path is not None and path.is_file() else None
        high_forward = Transformer.from_crs(high.crs.geodetic_crs, high.crs, always_xy=True) if high else None
        results = []
        for latitude, longitude in locations:
            coarse = sample_slope(elevation, elevation_forward, latitude, longitude, False)
            fine = sample_slope(high, high_forward, latitude, longitude, True) if high and latitude <= -87 else None
            if fine is not None:
                fine["roughness_rms_m"] = coarse["roughness_rms_m"] if coarse else None
                fine["elevation_m"] = coarse["elevation_m"] if coarse else None
            results.append(fine or coarse)
        return results


def local_slope(latitude: float, longitude: float):
    return region_slopes([(latitude, longitude)])[0]


@router.get("/slope")
def slope_at(latitude: float = Query(ge=-90, le=-80), longitude: float = Query(ge=-180, le=180)):
    try:
        slope = local_slope(latitude, longitude)
    except (OSError, KeyError, ValueError) as exc:
        raise HTTPException(503, str(exc)) from exc
    return slope or {"slope_p90_deg": None, "footprint_radius_m": None,
                     "resolution_m": None, "dataset": None}


def horizon_samples(src, latitude: float, longitude: float, azimuths: np.ndarray,
                    distances: np.ndarray):
    angles = np.deg2rad(azimuths)[:, None]
    arc = distances[None, :] / 1737400.0
    lat = math.radians(latitude)
    lon = math.radians(longitude)
    cos_arc = np.cos(arc)
    north_arc = np.sin(arc) * np.cos(angles)
    east_arc = np.sin(arc) * np.sin(angles)
    x_direction = np.cos(lat) * np.cos(lon) * cos_arc - np.sin(lat) * np.cos(lon) * north_arc - np.sin(lon) * east_arc
    y_direction = np.cos(lat) * np.sin(lon) * cos_arc - np.sin(lat) * np.sin(lon) * north_arc + np.cos(lon) * east_arc
    z_direction = np.sin(lat) * cos_arc + np.cos(lat) * north_arc
    destination_lat = np.arcsin(np.clip(z_direction, -1, 1))
    destination_lon = np.arctan2(y_direction, x_direction)
    forward = Transformer.from_crs(src.crs.geodetic_crs, src.crs, always_xy=True)
    x0, y0 = forward.transform(longitude, latitude)
    x, y = forward.transform(np.rad2deg(destination_lon).ravel(), np.rad2deg(destination_lat).ravel())
    origin = next(src.sample([(x0, y0)], masked=True))[0]
    if np.ma.is_masked(origin) or not np.isfinite(origin) or abs(float(origin)) >= 100000:
        raise ValueError("No elevation data at landing site")
    values = np.ma.asarray(list(src.sample(zip(x, y), masked=True)))[:, 0].reshape(len(azimuths), len(distances))
    valid = ~np.ma.getmaskarray(values) & np.isfinite(values.data)
    valid &= np.abs(values.data) < 100000
    curvature = distances ** 2 / (2 * 1737400.0)
    slopes = np.arctan2(values.data - float(origin) - curvature[None, :], distances[None, :])
    horizon = np.max(np.where(valid, slopes, -np.inf), axis=1)
    return np.rad2deg(horizon), valid


@lru_cache(maxsize=128)
def terrain_horizon_profile(latitude: float, longitude: float):
    azimuths = np.arange(0.0, 360.0, 2.0)
    far_distances = np.geomspace(80.0, 100000.0, 120)
    with elevation_dataset() as src:
        far_horizon, far_valid = horizon_samples(src, latitude, longitude, azimuths, far_distances)

    near_used = False
    if latitude <= -87:
        config = json.loads((DATA / "datasets.json").read_text(encoding="utf-8"))
        filename = config.get("high_resolution", {}).get("elevation")
        path = DATA / "source" / filename if filename else None
        if path is not None and path.is_file():
            near_distances = np.concatenate((np.arange(5.0, 255.0, 5.0),
                                             np.arange(260.0, 2010.0, 20.0)))
            with rasterio.open(path) as src:
                try:
                    near_horizon, near_valid = horizon_samples(src, latitude, longitude,
                                                               azimuths, near_distances)
                except ValueError:
                    near_valid = None
            if near_valid is not None and np.any(near_valid):
                far_horizon = np.maximum(far_horizon, near_horizon)
                near_used = True

    if not np.all(np.isfinite(far_horizon)):
        raise ValueError("DEM does not cover every horizon direction")
    farthest = np.max(np.where(far_valid, far_distances[None, :], 0), axis=1)
    return {"angles": tuple(float(value) for value in far_horizon),
            "near_5m_used": near_used,
            "far_coverage_min_km": round(float(np.min(farthest) / 1000), 1),
            "azimuth_step_deg": 2.0}


def terrain_horizon(latitude: float, longitude: float):
    return terrain_horizon_profile(latitude, longitude)["angles"]


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

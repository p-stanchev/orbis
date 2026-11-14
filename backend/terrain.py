import io
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
from rasterio.warp import reproject

router = APIRouter(prefix="/api/terrain", tags=["Terrain"])
DATA = Path(__file__).resolve().parent.parent / "data"
SIZE = 1024


def dataset_path(role: str) -> Path:
    config = json.loads((DATA / "datasets.json").read_text(encoding="utf-8"))
    path = DATA / "source" / config[role]["file"]
    if not path.is_file():
        raise FileNotFoundError(f"Missing dataset: {path.name}")
    return path


def elevation_dataset():
    return rasterio.open(dataset_path("elevation"))


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

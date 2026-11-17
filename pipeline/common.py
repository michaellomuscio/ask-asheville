"""Shared constants and helpers for the Asheville data pipeline.

Coordinates: the simulation works in meters on a local tangent plane centered on
Pack Square in downtown Asheville. x grows east, z grows south (Three.js
convention, y is up). Over the ~60 km extent the equirectangular projection used
here distorts distances by well under 1%; edge lengths for routing are measured
geodesically, so travel times are unaffected.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
CACHE = ROOT / "cache"
WORK = ROOT / "work"  # intermediate products (gitignored)
OUT = REPO / "docs" / "data"  # assets the browser loads (committed; docs/ is the published site)
for d in (CACHE, WORK, OUT):
    d.mkdir(parents=True, exist_ok=True)

STATE_FIPS = "37"
COUNTY_FIPS = "021"  # Buncombe
COUNTY_GEOID = STATE_FIPS + COUNTY_FIPS

# Projection origin: Pack Square, downtown Asheville.
LAT0 = 35.59510
LON0 = -82.55100
_phi = math.radians(LAT0)
M_PER_DEG_LAT = 111132.92 - 559.82 * math.cos(2 * _phi) + 1.175 * math.cos(4 * _phi)
M_PER_DEG_LON = 111412.84 * math.cos(_phi) - 93.5 * math.cos(3 * _phi)

# Default destination for drive times, and the center of the ORS reference isochrones: downtown
# Asheville (Pack Square, the projection origin).
FOCUS = {"name": "Downtown Asheville (Pack Square)", "lat": LAT0, "lon": LON0}



def project(lon, lat):
    """lon/lat (degrees, scalars or arrays) -> (x east, z south) meters."""
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    x = (lon - LON0) * M_PER_DEG_LON
    z = -(lat - LAT0) * M_PER_DEG_LAT
    return x, z


def unproject(x, z):
    x = np.asarray(x, dtype=np.float64)
    z = np.asarray(z, dtype=np.float64)
    return LON0 + x / M_PER_DEG_LON, LAT0 - z / M_PER_DEG_LAT


def haversine(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * np.arcsin(np.sqrt(a))


def load_json(path):
    return json.loads(Path(path).read_text())


def save_json(path, obj, indent=None):
    Path(path).write_text(json.dumps(obj, indent=indent, separators=(",", ":") if indent is None else None))


def county_shape():
    """Buncombe County polygon (shapely, lon/lat) from TIGER 2020."""
    import shapefile
    from shapely.geometry import shape

    sf = shapefile.Reader(str(CACHE / "tiger/tl_2020_37_county20/tl_2020_37_county20.shp"))
    for rec, shp in zip(sf.records(), sf.shapes()):
        if rec["COUNTYFP20"] == COUNTY_FIPS:
            return shape(shp.__geo_interface__)
    raise RuntimeError("Buncombe not found")


def bounds_meta():
    """Model extents, computed once from the county polygon and cached in work/bounds.json."""
    f = WORK / "bounds.json"
    if f.exists():
        return load_json(f)
    c = county_shape()
    lon0, lat0, lon1, lat1 = c.bounds
    # Roads and buildings: county + 2.5 km. Terrain: county + ~8 km of scenery.
    pad_net = 2500
    pad_ter = 8000
    meta = {
        "county_lonlat": [lon0, lat0, lon1, lat1],
        "net_lonlat": [lon0 - pad_net / M_PER_DEG_LON, lat0 - pad_net / M_PER_DEG_LAT,
                        lon1 + pad_net / M_PER_DEG_LON, lat1 + pad_net / M_PER_DEG_LAT],
        "terrain_lonlat": [lon0 - pad_ter / M_PER_DEG_LON, lat0 - pad_ter / M_PER_DEG_LAT,
                            lon1 + pad_ter / M_PER_DEG_LON, lat1 + pad_ter / M_PER_DEG_LAT],
    }
    save_json(f, meta, indent=1)
    return meta

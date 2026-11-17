"""Elevation and land cover rasters on the simulation grid.

Elevation: AWS Terrain Tiles (Terrarium encoding, public dataset; in the US the
source is USGS 3DEP). Zoom 13 is ~15.5 m per pixel at Asheville's latitude; it is
resampled bilinearly onto a 30 m grid in local meters.

Land cover: NLCD (MRLC GeoServer WMS), classified from its legend colors onto the
same grid (nearest neighbor).

Outputs work/terrain.npz: height (float32 meters, rows = z, cols = x), landcover
(uint8 NLCD codes), and the grid definition.
"""
from __future__ import annotations

import io
import math
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image

from common import CACHE, WORK, bounds_meta, project, unproject

Z = 13
CELL = 30.0
TILE_DIR = CACHE / "terrain" / f"z{Z}"
TILE_DIR.mkdir(parents=True, exist_ok=True)


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def fetch_tile(tx, ty):
    f = TILE_DIR / f"{tx}_{ty}.png"
    if not f.exists():
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{tx}/{ty}.png"
        for i in range(5):
            r = requests.get(url, timeout=60)
            if r.status_code == 200:
                f.write_bytes(r.content)
                break
        else:
            raise RuntimeError(url)
    a = np.asarray(Image.open(f).convert("RGB"), dtype=np.float64)
    return (a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256) - 32768


def grid_def():
    b = bounds_meta()["terrain_lonlat"]
    x0, z1 = project(b[0], b[1])
    x1, z0 = project(b[2], b[3])
    x0 = math.floor(float(x0) / CELL) * CELL
    z0 = math.floor(float(z0) / CELL) * CELL
    nx = int(math.ceil((float(x1) - x0) / CELL)) + 1
    nz = int(math.ceil((float(z1) - z0) / CELL)) + 1
    return {"x0": x0, "z0": z0, "cell": CELL, "nx": nx, "nz": nz}


def elevation(g):
    b = bounds_meta()["terrain_lonlat"]
    txa, tya = lonlat_to_tile(b[0], b[3], Z)
    txb, tyb = lonlat_to_tile(b[2], b[1], Z)
    tx0, tx1 = int(txa) - 1, int(txb) + 1
    ty0, ty1 = int(tya) - 1, int(tyb) + 1
    tiles = [(tx, ty) for ty in range(ty0, ty1 + 1) for tx in range(tx0, tx1 + 1)]
    print("terrain tiles", len(tiles))
    with ThreadPoolExecutor(12) as ex:
        arrs = list(ex.map(lambda t: fetch_tile(*t), tiles))
    W = (tx1 - tx0 + 1) * 256
    H = (ty1 - ty0 + 1) * 256
    mosaic = np.zeros((H, W), dtype=np.float32)
    for (tx, ty), a in zip(tiles, arrs):
        mosaic[(ty - ty0) * 256:(ty - ty0 + 1) * 256, (tx - tx0) * 256:(tx - tx0 + 1) * 256] = a
    xs = g["x0"] + np.arange(g["nx"]) * CELL
    zs = g["z0"] + np.arange(g["nz"]) * CELL
    X, Zg = np.meshgrid(xs, zs)
    lon, lat = unproject(X, Zg)
    n = 2 ** Z
    px = ((lon + 180) / 360 * n - tx0) * 256 - 0.5
    py = ((1 - np.arcsinh(np.tan(np.radians(lat))) / np.pi) / 2 * n - ty0) * 256 - 0.5
    ix = np.clip(np.floor(px).astype(int), 0, W - 2)
    iy = np.clip(np.floor(py).astype(int), 0, H - 2)
    fx = np.clip(px - ix, 0, 1)
    fy = np.clip(py - iy, 0, 1)
    h = (mosaic[iy, ix] * (1 - fx) * (1 - fy) + mosaic[iy, ix + 1] * fx * (1 - fy)
         + mosaic[iy + 1, ix] * (1 - fx) * fy + mosaic[iy + 1, ix + 1] * fx * fy)
    return h.astype(np.float32)


# NLCD legend colors (MRLC standard palette) -> class codes.
NLCD_COLORS = {
    11: (70, 107, 159), 12: (209, 222, 248), 21: (222, 197, 197), 22: (217, 146, 130), 23: (235, 0, 0),
    24: (171, 0, 0), 31: (179, 172, 159), 41: (104, 171, 95), 42: (28, 95, 44), 43: (181, 197, 143),
    52: (204, 184, 121), 71: (223, 223, 194), 81: (220, 217, 57), 82: (171, 108, 40), 90: (184, 217, 235),
    95: (108, 159, 184),
}


def landcover(g):
    b = bounds_meta()["terrain_lonlat"]
    f = CACHE / "nlcd" / "nlcd.png"
    if not f.exists():
        # WMS in EPSG:4326 at roughly 30 m per pixel; resampled onto the grid below.
        W = int((b[2] - b[0]) * 3600)  # ~1 arc-second
        H = int((b[3] - b[1]) * 3600)
        layers = ["mrlc_display:Annual_NLCD_LndCov_2024_CU_C1V1", "mrlc_display:NLCD_2021_Land_Cover_L48"]
        for layer in layers:
            params = {
                "service": "WMS", "version": "1.1.1", "request": "GetMap", "layers": layer, "styles": "",
                "srs": "EPSG:4326", "bbox": f"{b[0]},{b[1]},{b[2]},{b[3]}", "width": W, "height": H,
                "format": "image/png",
            }
            r = requests.get("https://www.mrlc.gov/geoserver/mrlc_display/wms", params=params, timeout=300)
            if r.status_code == 200 and r.headers.get("content-type", "").startswith("image"):
                f.write_bytes(r.content)
                (CACHE / "nlcd" / "layer.txt").write_text(layer)
                print("nlcd layer", layer, W, H)
                break
            print("nlcd layer failed", layer, r.status_code, r.text[:200], file=sys.stderr)
        else:
            return None
    img = np.asarray(Image.open(f).convert("RGB"), dtype=np.int32)
    H, W = img.shape[:2]
    codes = np.array(list(NLCD_COLORS.keys()), dtype=np.uint8)
    pal = np.array(list(NLCD_COLORS.values()), dtype=np.int32)
    flat = img.reshape(-1, 3)
    # Nearest palette color (the WMS can antialias at class edges).
    best = np.zeros(len(flat), dtype=np.int64)
    bestd = np.full(len(flat), 1 << 30, dtype=np.int64)
    for i, c in enumerate(pal):
        d = ((flat - c) ** 2).sum(1)
        m = d < bestd
        best[m] = i
        bestd[m] = d[m]
    cls = codes[best].reshape(H, W)
    cls[(img.sum(2) == 0) | (img.sum(2) == 765)] = 0
    xs = g["x0"] + np.arange(g["nx"]) * CELL
    zs = g["z0"] + np.arange(g["nz"]) * CELL
    X, Zg = np.meshgrid(xs, zs)
    lon, lat = unproject(X, Zg)
    ix = np.clip(((lon - b[0]) / (b[2] - b[0]) * W).astype(int), 0, W - 1)
    iy = np.clip(((b[3] - lat) / (b[3] - b[1]) * H).astype(int), 0, H - 1)
    return cls[iy, ix]


if __name__ == "__main__":
    g = grid_def()
    print("grid", g)
    h = elevation(g)
    print("elevation range", float(h.min()), float(h.max()))
    lc = landcover(g)
    if lc is None:
        lc = np.zeros_like(h, dtype=np.uint8)
        print("no land cover")
    else:
        vals, cnts = np.unique(lc, return_counts=True)
        print("landcover", dict(zip(vals.tolist(), cnts.tolist())))
    np.savez_compressed(WORK / "terrain.npz", height=h, landcover=lc, **{k: np.array(v) for k, v in g.items()})

"""Pack pipeline outputs into the compact files the browser loads (data/*.bin.gz).

  terrain.bin.gz    30 m heights (decimeters, row-delta encoded) + NLCD land cover
  roads.bin.gz      road graph: nodes, directed edges, shared polylines
  buildings.bin.gz  footprints (decimeter offsets) + kind, height, units, residents, jobs...
  water.bin.gz      lakes/river polygons and river/rail centerlines
  demand.bin.gz     LODES commute flows and school assignments
  addresses.bin.gz  county civic addresses (search) and their buildings
  county.json       county outline
  manifest.json     sources, build date, counts
"""
from __future__ import annotations

import datetime as dt
import gzip
import json
import math
import pickle

import numpy as np
import pandas as pd
from shapely.geometry import Polygon, LineString
from shapely.ops import transform

from bundle import write_bundle
from common import CACHE, FOCUS, LAT0, LON0, M_PER_DEG_LAT, M_PER_DEG_LON, OUT, WORK, county_shape, project, save_json

KIND_NAMES = ["house", "townhome", "condo", "apartment", "mobile_home", "group_quarters", "hotel", "retail", "office", "commercial",
              "industrial", "warehouse", "school", "university", "church", "hospital", "medical", "government", "civic", "recreation",
              "parking", "farm", "accessory", "utility", "mixed_use", "other"]


def kb(n):
    return f"{n / 1024 / 1024:.1f} MB"


def pack_terrain():
    t = np.load(WORK / "terrain.npz")
    h = t["height"].astype(np.float64)
    hmin = math.floor(float(h.min()))
    q = np.round((h - hmin) * 4).astype(np.int32)  # quarter meters
    p = q.copy()
    p[1:, 1:] = q[1:, 1:] - q[1:, :-1] - q[:-1, 1:] + q[:-1, :-1]
    p[0, 1:] = q[0, 1:] - q[0, :-1]
    p[1:, 0] = q[1:, 0] - q[:-1, 0]
    assert np.abs(p).max() < 32767 and q.max() < 32767
    meta = {"x0": float(t["x0"]), "z0": float(t["z0"]), "cell": float(t["cell"]), "nx": int(t["nx"]), "nz": int(t["nz"]),
            "hmin": hmin, "scale": 0.25,
            "encoding": "int16 quarter-meters above hmin, 2-D predictor: q[r][c] = v + q[r][c-1] + q[r-1][c] - q[r-1][c-1]; "
                        "row 0 and column 0 are 1-D deltas; q[0][0] is absolute",
            "landcover": "NLCD 2021 class codes"}
    raw = write_bundle(OUT / "terrain.bin.gz", meta, {"height": p.astype(np.int16).ravel(), "landcover": t["landcover"].astype(np.uint8).ravel()})
    return raw


def pack_roads():
    g = np.load(WORK / "graph.npz")
    meta_in = json.load(open(WORK / "graph_meta.json"))
    gw = np.zeros(len(g["node_x"]), dtype=np.uint8)
    for x in meta_in["gateways"]:
        gw[x["node"]] = 1
    meta = {"names": meta_in["names"], "classes": meta_in["classes"], "gateways": meta_in["gateways"],
            "flags": {"bridge": 1, "tunnel": 2, "roundabout": 4, "oneway": 8, "default_speed": 16},
            "ctrl": {"none": 0, "yield": 1, "stop": 2, "signal": 3},
            "speed_note": "speed = ORS-calibrated free-flow (m/s, used for every drive time); vsim = posted-limit speed simulated drivers aim for"}
    arrays = {
        "node_x": g["node_x"].astype(np.float32), "node_z": g["node_z"].astype(np.float32),
        "node_signal": g["node_signal"].astype(np.uint8), "node_in_county": g["node_in_county"].astype(np.uint8), "node_gateway": gw,
        "e_from": g["e_from"].astype(np.int32), "e_to": g["e_to"].astype(np.int32), "e_len": g["e_len"].astype(np.float32),
        "e_speed": g["e_speed"].astype(np.float32), "e_vsim": g["e_vsim"].astype(np.float32), "e_posted": g["e_posted"].astype(np.float32),
        "e_lanes": g["e_lanes"].astype(np.uint8), "e_cls": g["e_cls"].astype(np.uint8), "e_rank": g["e_rank"].astype(np.uint8),
        "e_flags": g["e_flags"].astype(np.uint8), "e_ctrl": g["e_ctrl"].astype(np.uint8), "e_name": g["e_name"].astype(np.int32),
        "e_geom": g["e_geom"].astype(np.int32), "e_dir": g["e_dir"].astype(np.int8),
        "g_off": g["g_off"].astype(np.int32), "g_x": g["g_x"].astype(np.float32), "g_z": g["g_z"].astype(np.float32),
    }
    return write_bundle(OUT / "roads.bin.gz", meta, arrays)


def pack_buildings():
    b = pd.read_parquet(WORK / "buildings.parquet")
    rings = pickle.load(open(WORK / "buildings_rings.pkl", "rb"))
    nodes = np.load(WORK / "building_nodes.npy")
    snap = np.load(WORK / "building_snap_m.npy")
    n = len(b)
    off = np.zeros(n + 1, dtype=np.uint32)
    for i, r in enumerate(rings):
        off[i + 1] = off[i] + len(r)
    rx = np.zeros(off[-1], dtype=np.int16)
    rz = np.zeros(off[-1], dtype=np.int16)
    cx = b.x.to_numpy()
    cz = b.z.to_numpy()
    for i, r in enumerate(rings):
        dx = np.round((r[:, 0] - cx[i]) * 10)
        dz = np.round((r[:, 1] - cz[i]) * 10)
        rx[off[i]:off[i + 1]] = np.clip(dx, -32767, 32767)
        rz[off[i]:off[i + 1]] = np.clip(dz, -32767, 32767)

    def pclass_code(c):
        if not c:
            return 0
        if c.isdigit():
            return int(c)
        return {"A": 1001, "F": 1002, "H": 1003, "W": 1004, "C": 1005}.get(c, 0)

    names = {int(i): s for i, s in enumerate(b.name) if s}
    meta = {"kinds": KIND_NAMES, "names": names, "count": n,
            "rings": "int16 decimeter offsets from (x, z); counter-clockwise seen from above",
            "parcel_class_letters": {"1001": "A present-use agricultural", "1002": "F present-use forest", "1003": "H horticultural",
                                     "1004": "W wildlife", "1005": "C conservation"}}
    clip16 = lambda v: np.clip(np.round(v), 0, 65535).astype(np.uint16)
    arrays = {
        "x": cx.astype(np.float32), "z": cz.astype(np.float32), "area": b.area.to_numpy(np.float32),
        "height_dm": clip16(b.height.to_numpy() * 10), "floors": np.clip(b.floors.to_numpy(), 1, 255).astype(np.uint8),
        "kind": b.kind.to_numpy(np.uint8), "roof": b.roof.to_numpy(np.uint8),
        "gable": np.round(b.gable_dir.to_numpy() / math.pi * 127).astype(np.int8),
        "units": clip16(b.units.to_numpy()), "households": clip16(b.households.to_numpy()), "residents": clip16(b.residents.to_numpy()),
        "gq": clip16(b.gq.to_numpy()), "kids10": clip16(b.kids.to_numpy() * 10), "seniors10": clip16(b.seniors.to_numpy() * 10),
        "jobs": clip16(b.jobs.to_numpy()), "block": b.block.to_numpy().astype(np.uint16),
        "parcel_class": np.array([pclass_code(c) for c in b.parcel_class], dtype=np.uint16),
        "addr_count": np.clip(b.addr_count.to_numpy(), 0, 255).astype(np.uint8),
        "node": nodes.astype(np.int32), "snap_dm": clip16(snap * 10),
        "r_off": off, "r_x": rx, "r_z": rz,
    }
    return write_bundle(OUT / "buildings.bin.gz", meta, arrays)


def pack_water():
    w = pickle.load(open(WORK / "osm_water.pkl", "rb"))
    ww = pickle.load(open(WORK / "osm_waterways.pkl", "rb"))
    rail = pickle.load(open(WORK / "osm_rail.pkl", "rb"))
    t = np.load(WORK / "terrain.npz")
    x0, z0 = float(t["x0"]), float(t["z0"])
    x1 = x0 + float(t["cell"]) * (int(t["nx"]) - 1)
    z1 = z0 + float(t["cell"]) * (int(t["nz"]) - 1)
    ring_off, ring_poly, ring_hole, px, pz = [0], [], [], [], []
    poly_kind = []
    pid = 0
    for item in w:
        if item["kind"] in ("wastewater",):
            continue
        for outer, holes in item["polys"]:
            xs, zs = project([p[0] for p in outer], [p[1] for p in outer])
            if xs.max() < x0 or xs.min() > x1 or zs.max() < z0 or zs.min() > z1:
                continue
            poly = Polygon(np.column_stack([xs, zs]))
            if not poly.is_valid:
                poly = poly.buffer(0)
            if poly.is_empty or poly.area < 250:
                continue
            geoms = [poly] if poly.geom_type == "Polygon" else [g for g in getattr(poly, "geoms", []) if g.geom_type == "Polygon"]
            for gpoly in geoms:
                gpoly = gpoly.simplify(2.0, preserve_topology=True)
                hole_polys = []
                for hring in holes:
                    hx, hz = project([p[0] for p in hring], [p[1] for p in hring])
                    hp = Polygon(np.column_stack([hx, hz]))
                    if hp.is_valid and hp.area > 100:
                        hole_polys.append(hp.simplify(2.0))
                for k, ring in enumerate([gpoly.exterior] + [h.exterior for h in hole_polys]):
                    c = np.asarray(ring.coords)[:-1]
                    if len(c) < 3:
                        continue
                    px.extend(c[:, 0])
                    pz.extend(c[:, 1])
                    ring_off.append(len(px))
                    ring_poly.append(pid)
                    ring_hole.append(1 if k > 0 else 0)
                poly_kind.append(1 if item["kind"] in ("river", "riverbank") else 0)
                pid += 1
    # River and major stream centerlines (rendered as ribbons where no polygon covers them).
    WIDTH = {"French Broad River": 60, "Swannanoa River": 16, "Pigeon River": 25, "Mills River": 12, "Broad River": 14}
    line_off, lx, lz, line_w, line_kind = [0], [], [], [], []
    for item in ww:
        if item["waterway"] != "river" and not (item.get("name") or "").endswith("Creek"):
            continue
        xs, zs = project([p[0] for p in item["coords"]], [p[1] for p in item["coords"]])
        if xs.max() < x0 or xs.min() > x1 or zs.max() < z0 or zs.min() > z1 or len(xs) < 2:
            continue
        ls = LineString(np.column_stack([xs, zs])).simplify(3.0)
        c = np.asarray(ls.coords)
        lx.extend(c[:, 0])
        lz.extend(c[:, 1])
        line_off.append(len(lx))
        line_w.append(WIDTH.get(item.get("name"), 9 if item["waterway"] == "river" else 3.5))
        line_kind.append(0)
    for item in rail:
        if item["railway"] not in ("rail",) or item.get("service") in ("yard", "siding", "spur", "crossover"):
            continue
        xs, zs = project([p[0] for p in item["coords"]], [p[1] for p in item["coords"]])
        if len(xs) < 2:
            continue
        c = np.asarray(LineString(np.column_stack([xs, zs])).simplify(2.0).coords)
        lx.extend(c[:, 0])
        lz.extend(c[:, 1])
        line_off.append(len(lx))
        line_w.append(4.0)
        line_kind.append(1 if not item.get("bridge") else 2)
    meta = {"poly_kind": {"0": "lake/pond/reservoir", "1": "river"}, "line_kind": {"0": "river/creek", "1": "railway", "2": "railway bridge"}}
    arrays = {"ring_off": np.array(ring_off, dtype=np.int32), "ring_poly": np.array(ring_poly, dtype=np.int32),
              "ring_hole": np.array(ring_hole, dtype=np.uint8), "poly_kind": np.array(poly_kind, dtype=np.uint8),
              "px": np.array(px, dtype=np.float32), "pz": np.array(pz, dtype=np.float32),
              "line_off": np.array(line_off, dtype=np.int32), "lx": np.array(lx, dtype=np.float32), "lz": np.array(lz, dtype=np.float32),
              "line_w": np.array(line_w, dtype=np.float32), "line_kind": np.array(line_kind, dtype=np.uint8)}
    print("water polygons", pid, "lines", len(line_w))
    return write_bundle(OUT / "water.bin.gz", meta, arrays)


def pack_demand():
    d = np.load(WORK / "demand.npz")
    corridors = json.load(open(WORK / "corridors.json"))
    schools = json.load(open(WORK / "schools.json"))
    meta = {"corridors": corridors,
            "schools": [{k: s[k] for k in ("name", "kind", "lo", "hi", "enrollment", "x", "z", "district", "modeled_local") if k in s} for s in schools],
            "od_note": "LEHD LODES 2023 OD, primary jobs (JT01), NC main+aux; negative ids = corridor (-1 - index)",
            "school_note": "students by (school index into meta.schools, census block); scaled to NCES enrollment"}
    arrays = {"od_home": d["od_home"].astype(np.int32), "od_work": d["od_work"].astype(np.int32), "od_count": d["od_count"].astype(np.float32),
              "sch_school": d["sch_school"].astype(np.int32), "sch_block": d["sch_block"].astype(np.int32), "sch_count": d["sch_count"].astype(np.float32)}
    return write_bundle(OUT / "demand.bin.gz", meta, arrays)


def pack_addresses():
    with gzip.open(WORK / "addresses.json.gz", "rt") as f:
        a = json.load(f)
    b = pd.read_parquet(WORK / "buildings.parquet")
    from scipy.spatial import cKDTree
    tree = cKDTree(b[["x", "z"]].to_numpy())
    d, k = tree.query(np.column_stack([a["x"], a["z"]]))
    bidx = np.where(d < 60, k, -1).astype(np.int32)
    labels = [lab.replace("|", " ").strip() for lab in a["label"]]
    meta = {"labels": "\n".join(labels), "note": "Buncombe County E911 civic address points (public)"}
    return write_bundle(OUT / "addresses.bin.gz", meta, {"x": np.array(a["x"], dtype=np.float32), "z": np.array(a["z"], dtype=np.float32),
                                                         "building": bidx})


def pack_county():
    c = transform(lambda x, y, z=None: project(x, y), county_shape()).simplify(15)
    rings = [np.asarray(c.exterior.coords).round(1).tolist()] if c.geom_type == "Polygon" else [np.asarray(p.exterior.coords).round(1).tolist() for p in c.geoms]
    save_json(OUT / "county.json", {"name": "Buncombe County, North Carolina", "rings": rings})


if __name__ == "__main__":
    sizes = {}
    sizes["terrain"] = pack_terrain()
    sizes["roads"] = pack_roads()
    sizes["buildings"] = pack_buildings()
    sizes["water"] = pack_water()
    sizes["demand"] = pack_demand()
    sizes["addresses"] = pack_addresses()
    pack_county()
    files = {}
    for p in sorted(OUT.iterdir()):
        files[p.name] = p.stat().st_size
    manifest = {
        "built": dt.datetime.now().isoformat(timespec="seconds"),
        "projection": {"type": "local equirectangular", "lat0": LAT0, "lon0": LON0, "m_per_deg_lat": M_PER_DEG_LAT, "m_per_deg_lon": M_PER_DEG_LON,
                       "axes": "x east, z south, y up (meters)"},
        "focus": FOCUS,
        "files": files,
        "sources": [
            {"name": "OpenStreetMap", "use": "roads, buildings, water, rail, points of interest", "license": "ODbL 1.0", "attribution": "© OpenStreetMap contributors",
             "date": "Geofabrik North Carolina extract, 2026-10-05"},
            {"name": "Buncombe County GIS", "use": "parcel land-use class codes, E911 address points, school attendance districts", "license": "public records (county open data)"},
            {"name": "U.S. Census Bureau, 2020 Census", "use": "block population, housing units, households, ages (PL 94-171, DHC)", "license": "public domain"},
            {"name": "U.S. Census Bureau, ACS 2020-2024 5-year", "use": "block group income, education, household size, housing, commuting", "license": "public domain"},
            {"name": "U.S. Census Bureau, LEHD LODES 8 (2023)", "use": "home-to-work commute flows and jobs by block", "license": "public domain"},
            {"name": "NCES CCD 2022-23 and PSS 2021-22", "use": "school locations, grades and enrollment", "license": "public domain"},
            {"name": "USGS 3DEP via AWS Terrain Tiles", "use": "elevation", "license": "public domain (attribution: Mapzen/Tilezen, USGS)"},
            {"name": "MRLC NLCD 2021", "use": "land cover", "license": "public domain"},
            {"name": "openrouteservice 9.10", "use": "free-flow drive-time calibration and isochrones (run locally)", "license": "GPL-3.0 engine; data © OpenStreetMap contributors"},
        ],
    }
    save_json(OUT / "manifest.json", manifest, indent=1)
    for k, v in files.items():
        print(f"{k:24s} {kb(v)}")
    print("raw sizes", {k: kb(v) for k, v in sizes.items()})

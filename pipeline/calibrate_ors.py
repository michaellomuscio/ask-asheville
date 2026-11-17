"""Calibrate the simulation's free-flow road speeds against openrouteservice.

ORS (openrouteservice 9.10) is the reference for "how long does this drive
take with no traffic". The simulation needs its own road graph to move vehicles and
add congestion, so its free-flow speeds are fitted to ORS:

1. Snap every building to a road node it can actually be reached from (not a freeway).
2. Sample thousands of origin/destination pairs weighted by where people live and work.
3. Ask local ORS for driving times (matrix endpoint) and compute the graph's own times
   with Dijkstra, splitting each path's time by road class.
4. Fit one time multiplier per road-class group (non-negative least squares) and apply.

Also saves ORS drive-time isochrones around downtown (common.FOCUS) and a validation report.
`python calibrate_ors.py isochrones` refreshes only the isochrones (ORS must be running).
Writes work/graph.npz (calibrated e_speed), work/building_nodes.npy, data/ors_reference.json.
"""
from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd
import requests
from scipy.optimize import nnls
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import dijkstra
from scipy.spatial import cKDTree

from common import FOCUS, OUT, WORK, project, save_json, unproject

ORS = "http://localhost:8093/ors/v2"
GROUPS = [("motorway", {0, 1}), ("trunk/primary", {2, 3, 4, 5}), ("secondary", {6, 7}), ("tertiary", {8, 9}),
          ("unclassified", {10}), ("residential", {11, 12}), ("service", {13, 14, 15})]


def main():
    g = dict(np.load(WORK / "graph.npz"))
    n = len(g["node_x"])
    E = len(g["e_from"])
    cls = g["e_cls"].astype(int)
    group_of = np.zeros(16, dtype=int)
    for gi, (_, s) in enumerate(GROUPS):
        for c in s:
            group_of[c] = gi
    egroup = group_of[cls]

    # --- Snap buildings to accessible nodes --------------------------------------------------------
    bad = np.zeros(n, dtype=bool)
    good = np.zeros(n, dtype=bool)
    for f, t, c in zip(g["e_from"], g["e_to"], cls):
        if c in (0, 1, 2, 3):  # freeways and their ramps, trunk expressways
            bad[f] = True
            bad[t] = True
        else:
            good[f] = True
            good[t] = True
    access = good  # a node touching any ordinary street is reachable from a driveway
    cand = np.where(access)[0]
    tree = cKDTree(np.column_stack([g["node_x"][cand], g["node_z"][cand]]))
    bld = pd.read_parquet(WORK / "buildings.parquet")
    d, k = tree.query(np.column_stack([bld.x.to_numpy(), bld.z.to_numpy()]))
    bnode = cand[k].astype(np.int32)
    np.save(WORK / "building_nodes.npy", bnode)
    np.save(WORK / "building_snap_m.npy", d.astype(np.float32))
    print("buildings snapped; median distance", round(float(np.median(d)), 1), "m; 95th", round(float(np.percentile(d, 95)), 1))

    # --- Sample pairs ----------------------------------------------------------------------------------
    rng = np.random.default_rng(7)
    res_w = bld.residents.to_numpy(dtype=np.float64)
    job_w = bld.jobs.to_numpy(dtype=np.float64)
    in_county = g["node_in_county"].astype(bool)

    def pick(weights, k):
        p = weights / weights.sum()
        return np.unique(bnode[rng.choice(len(p), size=k * 2, p=p)])[:k]

    fx, fz = project(FOCUS["lon"], FOCUS["lat"])
    focus_node = int(cand[tree.query([float(fx), float(fz)])[1]])

    w = g["e_len"] / g["e_speed"]
    A = csr_matrix((w, (g["e_from"], g["e_to"])), shape=(n, n))
    # Duplicate parallel edges: csr sums them; keep the minimum instead.
    order = np.lexsort((w, g["e_to"], g["e_from"]))
    f_s, t_s, w_s = g["e_from"][order], g["e_to"][order], w[order]
    first = np.ones(len(order), dtype=bool)
    first[1:] = (f_s[1:] != f_s[:-1]) | (t_s[1:] != t_s[:-1])
    edge_of_pair = {}
    for e_idx, f, t in zip(order[first], f_s[first], t_s[first]):
        edge_of_pair[(int(f), int(t))] = int(e_idx)
    A = csr_matrix((w_s[first], (f_s[first], t_s[first])), shape=(n, n))

    rows = []
    for batch in range(4):
        O = pick(res_w, 45)
        D = pick(job_w + res_w * 0.3, 45)
        if batch == 0:
            D = np.concatenate([[focus_node], D[:44]])
        locs = [[float(g["node_lon"][i]), float(g["node_lat"][i])] for i in np.concatenate([O, D])]
        body = {"locations": locs, "sources": list(range(len(O))), "destinations": list(range(len(O), len(O) + len(D))),
                "metrics": ["duration", "distance"]}
        r = requests.post(f"{ORS}/matrix/driving-car", json=body, timeout=600)
        r.raise_for_status()
        js = r.json()
        dur = np.array(js["durations"], dtype=object)
        dist, pred = dijkstra(A, directed=True, indices=O, return_predecessors=True)
        for oi, o in enumerate(O):
            for di, dd in enumerate(D):
                t_ors = js["durations"][oi][di]
                if t_ors is None or o == dd or not np.isfinite(dist[oi, dd]):
                    continue
                # Walk the path back to split time by group.
                per = np.zeros(len(GROUPS))
                cur = dd
                steps = 0
                while cur != o and steps < 100000:
                    p = pred[oi, cur]
                    if p < 0:
                        break
                    e = edge_of_pair[(int(p), int(cur))]
                    per[egroup[e]] += w[e]
                    cur = p
                    steps += 1
                rows.append((t_ors, dist[oi, dd], per, int(o), int(dd), js["distances"][oi][di]))
        print("batch", batch, "pairs", len(rows))

    t_ors = np.array([r[0] for r in rows])
    t_sim = np.array([r[1] for r in rows])
    P = np.array([r[2] for r in rows])
    keep = (t_ors > 120) & (t_ors < 5400)
    ratio0 = t_sim[keep] / t_ors[keep]
    print("before: median sim/ORS", round(float(np.median(ratio0)), 3), "mean abs err min",
          round(float(np.mean(np.abs(t_sim[keep] - t_ors[keep])) / 60), 2))
    # Weighted NNLS on relative error.
    wt = 1 / np.sqrt(t_ors[keep])
    f, _ = nnls(P[keep] * wt[:, None], t_ors[keep] * wt)
    used = P[keep].sum(axis=0) > 0
    f = np.where(used & (f > 0.3), np.clip(f, 0.5, 3.0), 1.0)
    t_fit = P[keep] @ f
    ratio1 = t_fit / t_ors[keep]
    print("factors", {GROUPS[i][0]: round(float(v), 3) for i, v in enumerate(f)})
    print("after: median", round(float(np.median(ratio1)), 3), "within 10%", round(float(np.mean(np.abs(ratio1 - 1) < 0.1)), 3),
          "within 1 min", round(float(np.mean(np.abs(t_fit - t_ors[keep]) < 60)), 3),
          "mean abs err min", round(float(np.mean(np.abs(t_fit - t_ors[keep])) / 60), 2))
    # e_vsim: the speed simulated drivers aim for (posted-limit based, unchanged).
    # e_speed: ORS-consistent free-flow speed used for routing and every drive-time number.
    g["e_vsim"] = g["e_speed"].astype(np.float32)
    g["e_speed"] = (g["e_speed"] / f[egroup]).astype(np.float32)
    np.savez_compressed(WORK / "graph.npz", **g)
    for lo, hi in ((2, 5), (5, 10), (10, 20), (20, 40), (40, 90)):
        m = (t_ors[keep] >= lo * 60) & (t_ors[keep] < hi * 60)
        if m.any():
            print(f"  {lo:>2}-{hi:<2} min: n={int(m.sum()):5d} median ratio {np.median(ratio1[m]):.3f} "
                  f"mean abs err {np.mean(np.abs(t_fit[m] - t_ors[keep][m])) / 60:.2f} min")

    rings = ors_isochrones(FOCUS["lon"], FOCUS["lat"])
    sample = [{"ors_min": round(r[0] / 60, 2), "sim_min": round(float(t), 2)} for r, t in zip([rows[i] for i in np.where(keep)[0]][:400], t_fit[:400] / 60)]
    save_json(OUT / "ors_reference.json", {
        "engine": "openrouteservice 9.10 (local), driving-car",
        "osm_extract": "Geofabrik North Carolina, 2026-10-05",
        "pairs": int(keep.sum()),
        "factors": {GROUPS[i][0]: round(float(v), 4) for i, v in enumerate(f)},
        "median_ratio_before": round(float(np.median(ratio0)), 4),
        "median_ratio_after": round(float(np.median(ratio1)), 4),
        "within_10pct": round(float(np.mean(np.abs(ratio1 - 1) < 0.1)), 4),
        "within_1min": round(float(np.mean(np.abs(t_fit - t_ors[keep]) < 60)), 4),
        "mean_abs_err_min": round(float(np.mean(np.abs(t_fit - t_ors[keep])) / 60), 3),
        "isochrones": {"center": FOCUS, "rings": rings},
        "sample": sample,
    })
    print("focus node", focus_node, "isochrones", [r["minutes"] for r in rings])


def ors_isochrones(lon, lat):
    """ORS drive-time zones (10-45 min) to a point, projected to local meters."""
    body = {"locations": [[lon, lat]], "range": [600, 900, 1200, 1800, 2700], "range_type": "time",
            "location_type": "destination", "smoothing": 0.25}
    iso = requests.post(f"{ORS}/isochrones/driving-car", json=body, timeout=600)
    iso.raise_for_status()
    rings = []
    for ft in iso.json()["features"]:
        geom = ft["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        out = []
        for poly in polys:
            ring = poly[0]
            xs, zs = project([p[0] for p in ring], [p[1] for p in ring])
            out.append([[round(float(a), 1), round(float(b), 1)] for a, b in zip(xs, zs)])
        rings.append({"minutes": ft["properties"]["value"] / 60, "polygons": out})
    return rings


def isochrones_only():
    """Refresh just the isochrones in data/ors_reference.json."""
    ref = json.loads((OUT / "ors_reference.json").read_text())
    ref.pop("cds_isochrones", None)
    ref["isochrones"] = {"center": FOCUS, "rings": ors_isochrones(FOCUS["lon"], FOCUS["lat"])}
    save_json(OUT / "ors_reference.json", ref)
    print("isochrones around", FOCUS["name"], [r["minutes"] for r in ref["isochrones"]["rings"]])


if __name__ == "__main__":
    import sys
    isochrones_only() if sys.argv[1:] == ["isochrones"] else main()

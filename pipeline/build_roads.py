"""Build the routable, renderable road network from OSM ways.

Network area: Buncombe County plus a 2.5 km buffer. Ways are split at every node
shared with another kept way (intersections) and at the area boundary. Each
segment becomes one or two directed edges sharing one polyline.

Per edge: length (geodesic), free-flow speed (posted limit or class default),
lanes per direction, class, priority rank, oneway, bridge/tunnel, roundabout,
name, and the traffic control a driver meets at its downstream end (signal,
stop, yield). Elevations come from the 30 m terrain grid; bridge and tunnel
spans are interpolated straight between their abutments, everything else is
lightly smoothed. Only the largest strongly connected component is kept, so
every node can reach every other node.

Writes work/graph.npz and work/graph_meta.json.
"""
from __future__ import annotations

import json
import math
import pickle
import re
from collections import Counter, defaultdict

import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from shapely.geometry import Point
from shapely.ops import transform
from shapely.prepared import prep

from common import WORK, county_shape, haversine, project, save_json

BUFFER_M = 2500.0

CLASS_CODES = ["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
               "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
               "service", "road", "busway"]
CLS = {c: i for i, c in enumerate(CLASS_CODES)}
# Priority at junctions (higher wins).
RANK = {"motorway": 8, "trunk": 7, "primary": 6, "secondary": 5, "tertiary": 4, "unclassified": 3, "residential": 2,
        "road": 2, "busway": 2, "living_street": 1, "service": 1,
        "motorway_link": 6, "trunk_link": 5, "primary_link": 5, "secondary_link": 4, "tertiary_link": 3}
# Default posted speed (mph) where OSM has no maxspeed. NC statutory: 55 rural, 35 urban.
DEFAULT_MPH = {"motorway": 65, "motorway_link": 45, "trunk": 55, "trunk_link": 40, "primary": 45, "primary_link": 35,
               "secondary": 45, "secondary_link": 30, "tertiary": 40, "tertiary_link": 30, "unclassified": 35,
               "residential": 25, "living_street": 15, "service": 15, "road": 25, "busway": 25}
DEFAULT_LANES = {"motorway": 2, "trunk": 2, "primary": 1, "secondary": 1}
EXCLUDE_SERVICE = {"parking_aisle", "driveway", "drive-through", "drive_through", "emergency_access", "parking",
                   "private", "bus", "slipway"}

MPH = 1.609344


def parse_speed(v):
    if not v:
        return None
    v = v.strip().lower()
    if v in ("none", "signals", "walk", "variable"):
        return None
    m = re.match(r"^(\d+(?:\.\d+)?)\s*(mph|km/h|kmh|kph)?", v)
    if not m:
        return None
    x = float(m.group(1))
    unit = m.group(2)
    if unit == "mph":
        return x * MPH
    if unit is None and x <= 75:  # US mappers often omit "mph"; plausible road values are mph
        return x * MPH
    return x


def parse_int(v):
    try:
        return max(1, int(float(str(v).split(";")[0])))
    except (TypeError, ValueError):
        return None


def keep_way(t):
    hw = t.get("highway")
    if hw not in CLS:
        return False
    if t.get("area") == "yes":
        return False
    if hw == "service" and t.get("service") in EXCLUDE_SERVICE:
        return False
    acc = t.get("motor_vehicle") or t.get("motorcar") or t.get("vehicle") or t.get("access")
    if acc in ("no", "private", "agricultural", "forestry", "delivery", "emergency", "permit"):
        return False
    if t.get("oneway") in ("reversible", "alternating"):
        return False
    return True


def oneway_dir(t):
    """+1 forward only, -1 backward only, 0 both ways."""
    ow = (t.get("oneway") or "").lower()
    if ow in ("yes", "true", "1"):
        return 1
    if ow in ("-1", "reverse"):
        return -1
    if ow in ("no", "false", "0"):
        return 0
    if t.get("junction") in ("roundabout", "circular"):
        return 1
    if t.get("highway") in ("motorway", "motorway_link"):
        return 1
    return 0


def lanes_per_dir(t, ow):
    hw = t["highway"]
    total = parse_int(t.get("lanes"))
    fwd = parse_int(t.get("lanes:forward"))
    bwd = parse_int(t.get("lanes:backward"))
    base = hw.replace("_link", "")
    if ow != 0:
        n = total or fwd or (1 if hw.endswith("_link") else DEFAULT_LANES.get(base, 1))
        return (n, 0) if ow == 1 else (0, n)
    if fwd and bwd:
        return fwd, bwd
    if total:
        if total >= 2:
            # Center turn lanes ("lanes=3/5") don't add through capacity.
            f = total // 2
            return f, f
        return 1, 1
    n = DEFAULT_LANES.get(base, 1)
    return n, n


class Terrain:
    def __init__(self):
        t = np.load(WORK / "terrain.npz")
        self.h = t["height"]
        self.x0 = float(t["x0"])
        self.z0 = float(t["z0"])
        self.cell = float(t["cell"])

    def sample(self, x, z):
        fx = (np.asarray(x) - self.x0) / self.cell
        fz = (np.asarray(z) - self.z0) / self.cell
        ix = np.clip(np.floor(fx).astype(int), 0, self.h.shape[1] - 2)
        iz = np.clip(np.floor(fz).astype(int), 0, self.h.shape[0] - 2)
        tx = np.clip(fx - ix, 0, 1)
        tz = np.clip(fz - iz, 0, 1)
        h = self.h
        return (h[iz, ix] * (1 - tx) * (1 - tz) + h[iz, ix + 1] * tx * (1 - tz)
                + h[iz + 1, ix] * (1 - tx) * tz + h[iz + 1, ix + 1] * tx * tz)


def main():
    roads = pickle.load(open(WORK / "osm_roads.pkl", "rb"))
    controls = pickle.load(open(WORK / "osm_controls.pkl", "rb"))
    terrain = Terrain()

    county = county_shape()
    county_m = transform(lambda x, y, z=None: project(x, y), county)
    area = county_m.buffer(BUFFER_M)
    area_p = prep(area)
    county_p = prep(county_m)
    boundary = area.exterior

    ways = [w for w in roads if keep_way(w["tags"])]
    print("ways kept", len(ways), "of", len(roads))

    # Project every way's nodes once; mark which are inside the network area.
    node_xy = {}
    for w in ways:
        lon = np.array([c[0] for c in w["coords"]])
        lat = np.array([c[1] for c in w["coords"]])
        x, z = project(lon, lat)
        w["x"] = x
        w["z"] = z
        w["lon"] = lon
        w["lat"] = lat
        for nid, xi, zi, lo, la in zip(w["nodes"], x, z, lon, lat):
            node_xy[nid] = (xi, zi, lo, la)
    inside = {nid: area_p.contains(Point(v[0], v[1])) for nid, v in node_xy.items()}

    # Split ways where they leave the area. Each run of inside nodes becomes a piece;
    # where a way crosses the boundary a synthetic node is placed exactly on it, and
    # those boundary nodes are the gateways for traffic entering and leaving.
    from shapely.geometry import LineString
    pieces = []
    gateway_nodes = set()
    synth = [0]

    def boundary_node(w, i, j):
        """Synthetic node where segment (i -> j) of way w crosses the area boundary."""
        seg = LineString([(w["x"][i], w["z"][i]), (w["x"][j], w["z"][j])])
        hit = seg.intersection(boundary)
        if hit.is_empty:
            return None
        pts = [hit] if hit.geom_type == "Point" else list(getattr(hit, "geoms", []))
        pts = [p for p in pts if p.geom_type == "Point"]
        if not pts:
            return None
        p0 = Point(w["x"][i], w["z"][i])
        p = min(pts, key=lambda q: q.distance(p0))
        synth[0] += 1
        nid = -synth[0]
        from common import unproject
        lo, la = unproject(p.x, p.y)
        node_xy[nid] = (p.x, p.y, float(lo), float(la))
        return nid

    def flush(w, idxs, head=None, tail=None):
        ids = [w["nodes"][i] for i in idxs]
        xs = [w["x"][i] for i in idxs]
        zs = [w["z"][i] for i in idxs]
        if head is not None:
            ids.insert(0, head); xs.insert(0, node_xy[head][0]); zs.insert(0, node_xy[head][1])
        if tail is not None:
            ids.append(tail); xs.append(node_xy[tail][0]); zs.append(node_xy[tail][1])
        if len(ids) >= 2:
            pieces.append({"way": w["id"], "tags": w["tags"], "nodes": ids,
                           "lon": np.array([node_xy[n][2] for n in ids]), "lat": np.array([node_xy[n][3] for n in ids]),
                           "x": np.array(xs), "z": np.array(zs)})

    for w in ways:
        nodes = w["nodes"]
        run = []
        head = None
        for i, nid in enumerate(nodes):
            if inside[nid]:
                if not run and i > 0 and not inside[nodes[i - 1]]:
                    head = boundary_node(w, i, i - 1)
                    if head is not None:
                        gateway_nodes.add(head)
                run.append(i)
            else:
                if run:
                    tail = boundary_node(w, run[-1], i)
                    if tail is not None:
                        gateway_nodes.add(tail)
                    flush(w, run, head, tail)
                run = []
                head = None
        if run:
            flush(w, run, head, None)
    print("pieces", len(pieces), "boundary nodes", len(gateway_nodes))

    usage = Counter()
    for pc in pieces:
        nodes = pc["nodes"]
        for nid in set(nodes):
            usage[nid] += 1
        usage[nodes[0]] += 1
        usage[nodes[-1]] += 1
        c = Counter(nodes)
        for nid, k in c.items():
            if k > 1:
                usage[nid] += 1  # a way that touches itself (loops, lollipops) also splits there
    split_at = {nid for nid, k in usage.items() if k >= 2} | gateway_nodes

    # --- Segments ----------------------------------------------------------------------
    node_index = {}
    nodes_x, nodes_z, nodes_lon, nodes_lat = [], [], [], []

    def nidx(osm_id):
        i = node_index.get(osm_id)
        if i is None:
            i = len(nodes_x)
            node_index[osm_id] = i
            x, z, lo, la = node_xy[osm_id]
            nodes_x.append(x)
            nodes_z.append(z)
            nodes_lon.append(lo)
            nodes_lat.append(la)
        return i

    segs = []
    for pc in pieces:
        start = 0
        n = len(pc["nodes"])
        for k in range(1, n):
            nid = pc["nodes"][k]
            if nid in split_at or k == n - 1:
                sl = slice(start, k + 1)
                ids = pc["nodes"][sl]
                if len(ids) > 2 or (len(ids) == 2 and ids[0] != ids[1]):
                    segs.append({"way": pc["way"], "tags": pc["tags"], "osm": ids,
                                 "x": pc["x"][sl], "z": pc["z"][sl], "lon": pc["lon"][sl], "lat": pc["lat"][sl]})
                start = k
    print("segments", len(segs))

    names = {}
    name_list = [""]

    def name_id(t):
        nm = t.get("name") or ""
        ref = (t.get("ref") or "").replace(";", " / ")
        if nm and ref:
            label = f"{nm} ({ref})"
        else:
            label = nm or ref
        if label not in names:
            names[label] = len(name_list)
            name_list.append(label)
        return names[label] if label else 0

    edges = []  # directed
    geoms = []  # per segment: arrays x, z, y
    seg_meta = []
    for s in segs:
        t = s["tags"]
        hw = t["highway"]
        ow = oneway_dir(t)
        lf, lb = lanes_per_dir(t, ow)
        a = nidx(s["osm"][0])
        b = nidx(s["osm"][-1])
        if a == b and len(s["osm"]) <= 2:
            continue
        length = float(haversine(s["lon"][:-1], s["lat"][:-1], s["lon"][1:], s["lat"][1:]).sum())
        if length < 0.5:
            continue
        posted = parse_speed(t.get("maxspeed"))
        posted_kmh = posted if posted else DEFAULT_MPH[hw] * MPH
        flags = 0
        if t.get("bridge") not in (None, "no"):
            flags |= 1
        if t.get("tunnel") not in (None, "no") or t.get("covered") == "yes":
            flags |= 2
        if t.get("junction") in ("roundabout", "circular"):
            flags |= 4
        if ow != 0:
            flags |= 8
        if posted is None:
            flags |= 16  # speed is a default, not posted
        # Densify for elevation sampling (every ~20 m).
        xs, zs = [s["x"][0]], [s["z"][0]]
        osm_at = [s["osm"][0]]
        for i in range(1, len(s["x"])):
            dx = s["x"][i] - s["x"][i - 1]
            dz = s["z"][i] - s["z"][i - 1]
            d = math.hypot(dx, dz)
            n = int(d // 20)
            for k in range(1, n + 1):
                f = k / (n + 1)
                xs.append(s["x"][i - 1] + dx * f)
                zs.append(s["z"][i - 1] + dz * f)
                osm_at.append(None)
            xs.append(s["x"][i])
            zs.append(s["z"][i])
            osm_at.append(s["osm"][i])
        xs = np.array(xs)
        zs = np.array(zs)
        ys = terrain.sample(xs, zs).astype(np.float64)
        if flags & 3 and len(ys) > 2:
            # Straight deck/bore between the ends (bridges over valleys, tunnels under ridges).
            cum = np.concatenate([[0], np.cumsum(np.hypot(np.diff(xs), np.diff(zs)))])
            ys = ys[0] + (ys[-1] - ys[0]) * cum / max(cum[-1], 1e-6)
        elif len(ys) > 4:
            k = np.array([1, 2, 3, 2, 1], dtype=np.float64)
            k /= k.sum()
            pad = np.pad(ys, 2, mode="edge")
            sm = np.convolve(pad, k, mode="valid")
            sm[0] = ys[0]
            sm[-1] = ys[-1]
            ys = sm
        gi = len(geoms)
        geoms.append((xs.astype(np.float32), zs.astype(np.float32), ys.astype(np.float32)))
        # Controls met at each end, by direction of travel.
        ctrl_points = [(i, controls[o]) for i, o in enumerate(osm_at) if o is not None and o in controls]
        cum = np.concatenate([[0], np.cumsum(np.hypot(np.diff(xs), np.diff(zs)))])
        total = cum[-1]

        def end_control(forward):
            best = 0
            for i, c in ctrl_points:
                d_end = total - cum[i] if forward else cum[i]
                hwc = c.get("highway")
                dirn = (c.get("direction") or c.get("traffic_signals:direction") or "").lower()
                if dirn in ("forward", "backward"):
                    if (dirn == "forward") != forward:
                        continue
                if hwc == "traffic_signals" and d_end <= 45:
                    best = max(best, 3)
                elif hwc == "stop" and d_end <= 30:
                    best = max(best, 2)
                elif hwc == "give_way" and d_end <= 30:
                    best = max(best, 1)
            return best

        nid = name_id(t)
        seg_meta.append({"geom": gi, "a": a, "b": b, "cls": CLS[hw]})
        common = {"len": length, "cls": CLS[hw], "rank": RANK[hw], "name": nid, "geom": gi, "posted": posted_kmh, "flags": flags}
        if ow >= 0:
            edges.append({**common, "from": a, "to": b, "dir": 1, "lanes": lf or 1, "ctrl": end_control(True)})
        if ow <= 0:
            edges.append({**common, "from": b, "to": a, "dir": -1, "lanes": (lb or 1), "ctrl": end_control(False)})
    print("nodes", len(nodes_x), "directed edges", len(edges))

    # Signals at intersection nodes themselves apply to every approach.
    node_signal = np.zeros(len(nodes_x), dtype=np.uint8)
    rev_index = {v: k for k, v in node_index.items()}
    for i in range(len(nodes_x)):
        c = controls.get(rev_index[i])
        if c and c.get("highway") == "traffic_signals":
            node_signal[i] = 1
    for e in edges:
        if node_signal[e["to"]]:
            e["ctrl"] = 3

    # --- Largest strongly connected component ---------------------------------------------
    # One-way roads that cross the boundary end in a node you can only enter (or only
    # leave). The outside world connects them, so for this test every boundary node is
    # joined to a virtual "outside" node in both directions.
    n = len(nodes_x)
    src = [e["from"] for e in edges]
    dst = [e["to"] for e in edges]
    ext = n
    for o in gateway_nodes:
        i = node_index.get(o)
        if i is not None:
            src += [i, ext]
            dst += [ext, i]
    mat = coo_matrix((np.ones(len(src)), (np.array(src), np.array(dst))), shape=(n + 1, n + 1)).tocsr()
    ncomp, labels = connected_components(mat, directed=True, connection="strong")
    big = labels[ext]
    keep_node = labels[:n] == big
    print("SCC components", ncomp, "largest", int(keep_node.sum()), "of", n)
    remap = -np.ones(n, dtype=np.int64)
    remap[keep_node] = np.arange(int(keep_node.sum()))
    edges = [e for e in edges if keep_node[e["from"]] and keep_node[e["to"]]]
    for e in edges:
        e["from"] = int(remap[e["from"]])
        e["to"] = int(remap[e["to"]])
    sel = np.where(keep_node)[0]
    nodes_x = np.array(nodes_x)[sel]
    nodes_z = np.array(nodes_z)[sel]
    nodes_lon = np.array(nodes_lon)[sel]
    nodes_lat = np.array(nodes_lat)[sel]
    node_osm = np.array([rev_index[i] for i in sel], dtype=np.int64)  # negative = synthetic boundary node
    node_signal = node_signal[sel]
    used_geoms = sorted({e["geom"] for e in edges})
    gmap = {g: i for i, g in enumerate(used_geoms)}
    geoms = [geoms[g] for g in used_geoms]
    for e in edges:
        e["geom"] = gmap[e["geom"]]
    nodes_y = terrain.sample(nodes_x, nodes_z)

    # Node elevation should match its edges' ends (bridges end on abutments).
    for e in edges:
        gx, gz, gy = geoms[e["geom"]]
        if e["dir"] == 1:
            nodes_y[e["from"]] = gy[0]
            nodes_y[e["to"]] = gy[-1]

    # --- Gateways: where major roads leave the network area ---------------------------------
    gw = []
    osm_to_node = {int(o): i for i, o in enumerate(node_osm)}
    for o in gateway_nodes:
        i = osm_to_node.get(int(o))
        if i is None:
            continue
        gw.append(i)
    gw_set = set(gw)
    gw_info = defaultdict(lambda: {"in": [], "out": [], "rank": 0, "names": set()})
    for k, e in enumerate(edges):
        if e["cls"] in (CLS["service"], CLS["living_street"], CLS["residential"]):
            continue
        if e["to"] in gw_set:
            gw_info[e["to"]]["out"].append(k)
            gw_info[e["to"]]["rank"] = max(gw_info[e["to"]]["rank"], e["rank"])
            gw_info[e["to"]]["names"].add(e["name"])
        if e["from"] in gw_set:
            gw_info[e["from"]]["in"].append(k)
            gw_info[e["from"]]["rank"] = max(gw_info[e["from"]]["rank"], e["rank"])
            gw_info[e["from"]]["names"].add(e["name"])
    gateways = []
    for i, info in gw_info.items():
        if info["rank"] < RANK["tertiary"]:
            continue
        x, z = float(nodes_x[i]), float(nodes_z[i])
        label = " / ".join(sorted({name_list[nm] for nm in info["names"] if nm}))[:80]
        gateways.append({"node": int(i), "x": x, "z": z, "rank": info["rank"], "label": label,
                         "can_enter": bool(info["in"]), "can_exit": bool(info["out"])})
    print("gateways", len(gateways))

    # --- Free-flow speeds ------------------------------------------------------------------
    # Drivers average a little under the posted limit on most roads; ORS calibration
    # (calibrate_ors.py) refines these per class later.
    FACTOR = {"motorway": 1.0, "trunk": 0.95, "primary": 0.9, "secondary": 0.9, "tertiary": 0.9}
    for e in edges:
        base = CLASS_CODES[e["cls"]].replace("_link", "")
        f = FACTOR.get(base, 0.85)
        if CLASS_CODES[e["cls"]].endswith("_link"):
            f = 0.8
        e["speed"] = max(8.0, e["posted"] * f) / 3.6

    # --- Pack ----------------------------------------------------------------------------------
    gofs = np.zeros(len(geoms) + 1, dtype=np.int64)
    for i, g in enumerate(geoms):
        gofs[i + 1] = gofs[i] + len(g[0])
    gx = np.concatenate([g[0] for g in geoms])
    gz = np.concatenate([g[1] for g in geoms])
    gy = np.concatenate([g[2] for g in geoms])
    E = len(edges)
    arr = lambda key, dt: np.array([e[key] for e in edges], dtype=dt)
    in_county = np.array([county_p.contains(Point(x, z)) for x, z in zip(nodes_x, nodes_z)], dtype=np.uint8)
    np.savez_compressed(
        WORK / "graph.npz",
        node_x=nodes_x.astype(np.float32), node_z=nodes_z.astype(np.float32), node_y=nodes_y.astype(np.float32),
        node_lon=nodes_lon, node_lat=nodes_lat, node_osm=node_osm, node_signal=node_signal, node_in_county=in_county,
        e_from=arr("from", np.int32), e_to=arr("to", np.int32), e_len=arr("len", np.float32),
        e_speed=arr("speed", np.float32), e_posted=arr("posted", np.float32), e_lanes=arr("lanes", np.uint8),
        e_cls=arr("cls", np.uint8), e_rank=arr("rank", np.uint8), e_flags=arr("flags", np.uint8),
        e_ctrl=arr("ctrl", np.uint8), e_name=arr("name", np.int32), e_geom=arr("geom", np.int32), e_dir=arr("dir", np.int8),
        g_off=gofs, g_x=gx, g_z=gz, g_y=gy,
    )
    save_json(WORK / "graph_meta.json", {"names": name_list, "classes": CLASS_CODES, "gateways": gateways}, indent=None)
    sig_edges = sum(1 for e in edges if e["ctrl"] == 3)
    stop_edges = sum(1 for e in edges if e["ctrl"] == 2)
    km = sum(e["len"] for e in edges if e["dir"] == 1 or e["flags"] & 8) / 1000
    print(f"final nodes {len(nodes_x)} edges {E} geom pts {len(gx)} road-km {km:.0f} signal-approaches {sig_edges} stop-approaches {stop_edges}")


if __name__ == "__main__":
    main()

"""Travel demand inputs: who commutes where, and which school each child attends.

Commutes: LEHD LODES 2023 Origin-Destination, primary jobs (JT01), NC main + aux files.
Every worker living or working in Buncombe County is kept as a home-block -> work-block
flow. The other end of a flow outside the county becomes a corridor (I-26 toward
Hendersonville, I-40 toward Canton...) chosen by the outside county's direction.

Schools: the county's attendance districts give each block its zoned elementary,
intermediate, middle and high school (Asheville City district: the city schools).
Charter and private students are spread over those schools by enrollment and
distance. Shares come from ACS B14002 (private) and NC DPI/NCES enrollments.

Writes data/demand.bin.gz pieces via pack.py inputs: work/demand.npz, work/schools.json.
"""
from __future__ import annotations

import json
import math
import pickle
import re
from collections import defaultdict

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import Point, shape
from shapely.ops import transform

from common import CACHE, WORK, project, save_json

# Corridors (gateway groups). Each is matched to gateway nodes by road label and position.
CORRIDORS = [
    {"id": "i26e", "label": "I-26 toward Hendersonville / Spartanburg", "match": ["I 26"], "near": (35.4017, -82.5121)},
    {"id": "us25s", "label": "US-25 toward Fletcher / Hendersonville", "match": ["US 25"], "near": (35.4037, -82.5102)},
    {"id": "nc191", "label": "NC-191 / NC-280 toward Mills River / Brevard", "match": ["NC 191", "NC 280"], "near": (35.4070, -82.5660)},
    {"id": "i40w", "label": "I-40 toward Canton / Tennessee", "match": ["I 40"], "near": (35.5409, -82.8015)},
    {"id": "us19w", "label": "US-19/23 toward Canton / Waynesville", "match": ["US 19"], "near": (35.5362, -82.8047)},
    {"id": "nc63", "label": "NC-63 / Newfound Road toward Haywood", "match": ["NC 63", "Newfound", "Beaverdam"], "near": (35.6500, -82.8300)},
    {"id": "i26n", "label": "I-26 toward Mars Hill / Johnson City", "match": ["I 26"], "near": (35.8195, -82.5361)},
    {"id": "us25n", "label": "US-25/70 toward Marshall", "match": ["US 25", "US 70"], "near": (35.7781, -82.6319)},
    {"id": "nc197", "label": "NC-197 / Barnardsville toward Yancey", "match": ["NC 197"], "near": (35.8266, -82.3282)},
    {"id": "i40e", "label": "I-40 toward Old Fort / Charlotte", "match": ["I 40"], "near": (35.6242, -82.2382)},
    {"id": "us74a", "label": "US-74A toward Bat Cave / Lake Lure", "match": ["US 74A", "Gerton", "NC 9", "US 64"], "near": (35.4600, -82.3000)},
]
# Outside county (state+county FIPS prefix) -> corridor weights.
COUNTY_CORRIDORS = {
    "37089": {"i26e": 0.55, "us25s": 0.3, "nc191": 0.15},  # Henderson
    "37175": {"nc191": 0.55, "i26e": 0.45},  # Transylvania
    "37149": {"i26e": 0.9, "us74a": 0.1},  # Polk
    "37087": {"i40w": 0.6, "us19w": 0.35, "nc63": 0.05},  # Haywood
    "37099": {"i40w": 0.4, "us19w": 0.6},  # Jackson
    "37173": {"us19w": 0.6, "i40w": 0.4}, "37113": {"us19w": 0.7, "i40w": 0.3}, "37039": {"us19w": 0.7, "i40w": 0.3},
    "37075": {"us19w": 0.6, "i40w": 0.4}, "37043": {"us19w": 0.7, "i40w": 0.3},
    "37115": {"i26n": 0.6, "us25n": 0.3, "nc63": 0.1},  # Madison
    "37199": {"i26n": 0.7, "nc197": 0.3}, "37121": {"i26n": 0.85, "nc197": 0.15}, "37011": {"i26n": 0.6, "i40e": 0.4},
    "37111": {"i40e": 1.0},  # McDowell
    "37161": {"us74a": 0.35, "i26e": 0.4, "i40e": 0.25},  # Rutherford
    "37045": {"i26e": 0.5, "i40e": 0.3, "us74a": 0.2},  # Cleveland
}
STATE_CORRIDORS = {"45": {"i26e": 0.95, "us25s": 0.05}, "47": {"i26n": 0.45, "i40w": 0.55}, "13": {"i26e": 0.5, "us19w": 0.5},
                   "51": {"i26n": 0.4, "i40e": 0.6}}
DEFAULT_CORRIDOR = {"i40e": 0.82, "i26e": 0.18}  # rest of NC (Piedmont, east)


def corridor_weights(geoid):
    c = geoid[:5]
    if c in COUNTY_CORRIDORS:
        return COUNTY_CORRIDORS[c]
    if geoid[:2] != "37":
        return STATE_CORRIDORS.get(geoid[:2], {"i40e": 0.5, "i26e": 0.5})
    return DEFAULT_CORRIDOR


def norm_name(s):
    s = (s or "").upper()
    s = re.sub(r"\b(ELEMENTARY|ELEM|SCHOOL|INTERMEDIATE|MIDDLE|HIGH|PRIMARY|PRIM)\b", " ", s)
    s = s.replace("/", " ").replace(".", " ").replace("-", " ").replace("'", "")
    return " ".join(s.split())


def main():
    meta = json.load(open(WORK / "graph_meta.json"))
    g = np.load(WORK / "graph.npz")
    gateways = meta["gateways"]

    # --- Corridors -> gateway nodes ---------------------------------------------------------------
    corridors = []
    for c in CORRIDORS:
        cx, cz = project(c["near"][1], c["near"][0])
        cand = []
        for gw in gateways:
            label = gw["label"]
            if not any(m in label for m in c["match"]):
                continue
            d = math.hypot(gw["x"] - float(cx), gw["z"] - float(cz))
            if d < 6000:
                cand.append((d, gw))
        cand.sort(key=lambda t: t[0])
        enters = [gw["node"] for d, gw in cand if gw["can_enter"]][:2]
        exits = [gw["node"] for d, gw in cand if gw["can_exit"]][:2]
        if not enters or not exits:
            # Fall back to the nearest gateway of any label.
            near = sorted(gateways, key=lambda gw: math.hypot(gw["x"] - float(cx), gw["z"] - float(cz)))
            enters = enters or [gw["node"] for gw in near if gw["can_enter"]][:1]
            exits = exits or [gw["node"] for gw in near if gw["can_exit"]][:1]
        corridors.append({"id": c["id"], "label": c["label"], "enter": enters, "exit": exits,
                          "x": round(float(cx), 1), "z": round(float(cz), 1)})
        print(f"corridor {c['id']:6s} enter {enters} exit {exits}  {c['label']}")
    cidx = {c["id"]: i for i, c in enumerate(corridors)}

    # --- LODES OD ---------------------------------------------------------------------------------------
    blocks_order = pd.read_parquet(WORK / "block_order.parquet").geoid.tolist()
    bidx = {gid: i for i, gid in enumerate(blocks_order)}
    frames = []
    for f in ("nc_od_main_JT01_2023.csv.gz", "nc_od_aux_JT01_2023.csv.gz"):
        df = pd.read_csv(CACHE / "lodes" / f, dtype={"w_geocode": str, "h_geocode": str},
                         usecols=["w_geocode", "h_geocode", "S000", "SE01", "SE02", "SE03"])
        frames.append(df[df.w_geocode.str.startswith("37021") | df.h_geocode.str.startswith("37021")])
    od = pd.concat(frames, ignore_index=True)
    print("OD rows touching Buncombe", len(od), "workers", int(od.S000.sum()))
    home, work, count = [], [], []
    ext_split = 0
    for h, w, n in zip(od.h_geocode.to_numpy(), od.w_geocode.to_numpy(), od.S000.to_numpy()):
        hi = bidx.get(h)
        wi = bidx.get(w)
        if hi is not None and wi is not None:
            home.append(hi)
            work.append(wi)
            count.append(int(n))
            continue
        if hi is None and wi is None:
            continue
        # One end outside: split the flow across corridors for the outside county.
        weights = corridor_weights(h if hi is None else w)
        for cid, share in weights.items():
            k = n * share
            if k <= 0:
                continue
            code = -1 - cidx[cid]
            home.append(hi if hi is not None else code)
            work.append(wi if wi is not None else code)
            count.append(k)
            ext_split += 1
    home = np.array(home, dtype=np.int32)
    work = np.array(work, dtype=np.int32)
    count = np.array(count, dtype=np.float32)
    # Collapse duplicates created by the corridor split.
    key = home.astype(np.int64) * 100000 + (work.astype(np.int64) + 50)
    uk, inv = np.unique(key, return_inverse=True)
    tot = np.bincount(inv, weights=count)
    home = (uk // 100000).astype(np.int32)
    work = (uk % 100000 - 50).astype(np.int32)
    count = tot.astype(np.float32)
    internal = (home >= 0) & (work >= 0)
    print("flows", len(home), "internal workers", int(count[internal].sum()), "in-commuters", int(count[home < 0].sum()),
          "out-commuters", int(count[work < 0].sum()))

    # --- Schools -------------------------------------------------------------------------------------------
    ccd = json.load(open(CACHE / "schools" / "ccd2022_buncombe.json"))
    pss = json.load(open(CACHE / "schools" / "pss2122.json"))
    schools = []
    for s in ccd:
        if s.get("school_status") not in (1, 3, 4, 5, 8) or not s.get("enrollment"):
            continue
        lo = s.get("lowest_grade_offered")
        hi = s.get("highest_grade_offered")
        kind = "charter" if s.get("charter") == 1 else "public"
        name = s["school_name"]
        if "Virtual" in name:
            continue
        schools.append({"name": name, "kind": kind, "district": s.get("lea_name"), "lo": lo, "hi": hi,
                        "enrollment": int(s["enrollment"]), "lat": s["latitude"], "lon": s["longitude"], "nces": s.get("ncessch")})
    for s in pss:
        if s.get("county_fips") != "37021":
            continue
        gl = {"PK": -1, "K": 0}
        lo = gl.get(s.get("lo_grade"), None)
        if lo is None:
            try:
                lo = int(s.get("lo_grade"))
            except (TypeError, ValueError):
                lo = 0
        try:
            hi = int(s.get("hi_grade"))
        except (TypeError, ValueError):
            hi = 12
        nm = s["school_name"].title().replace("'S", "'s")
        if re.match(r"^\d", nm):
            nm = f"Early learning program ({nm})"  # PSS record named by its street address
        schools.append({"name": nm, "kind": "private", "district": s.get("orient_label"),
                        "lo": lo, "hi": hi, "enrollment": int(s.get("enrollment_total") or 0), "lat": s["latitude"], "lon": s["longitude"],
                        "nces": s.get("dest_id")})
    for s in schools:
        x, z = project(s["lon"], s["lat"])
        s["x"] = round(float(x), 1)
        s["z"] = round(float(z), 1)
    print("schools", len(schools), {k: sum(1 for s in schools if s["kind"] == k) for k in ("public", "charter", "private")})

    # Zoned schools from attendance districts.
    districts = [json.loads(l) for l in open(CACHE / "county" / "schools_layer2.ndjson")]
    dgeo = [transform(lambda x, y, z=None: project(x, y), shape(d["geometry"])) for d in districts]
    blk_geom = pickle.load(open(WORK / "blocks_m.pkl", "rb"))
    reps = shapely.points([(p.x, p.y) for p in (gg.representative_point() for gg in blk_geom)])
    dtree = shapely.STRtree(dgeo)
    bi, di = dtree.query(reps, predicate="within")
    block_district = -np.ones(len(blk_geom), dtype=np.int64)
    block_district[bi] = di
    miss = np.where(block_district < 0)[0]
    if len(miss):
        mb, md = dtree.query_nearest(reps[miss], return_distance=False)
        block_district[miss[mb]] = md

    pub = [i for i, s in enumerate(schools) if s["kind"] == "public"]
    by_norm = defaultdict(list)
    for i in pub:
        by_norm[norm_name(schools[i]["name"])].append(i)

    def find_school(nm, level):
        if not nm:
            return None
        key = norm_name(nm)
        cands = by_norm.get(key, [])
        if not cands:
            for k2, v in by_norm.items():
                if key and (key in k2 or k2 in key):
                    cands += v
        lv = {"elem": (0, 5), "int": (4, 6), "mid": (6, 8), "high": (9, 12)}[level]
        best = None
        for i in cands:
            s = schools[i]
            lo = s["lo"] if s["lo"] is not None else 0
            hi = s["hi"] if s["hi"] is not None else 12
            if lo <= lv[1] and hi >= lv[0]:
                if best is None or (schools[best]["hi"] or 0) < hi:
                    best = i
        return best

    blocks = pd.read_parquet(CACHE / "census" / "blocks_2020.parquet").set_index("geoid").reindex(blocks_order).fillna(0)
    acs = pd.read_parquet(CACHE / "census" / "acs_bg_core.parquet").set_index("geoid")
    k12_pri = acs[[f"B14002_{i:03d}E" for i in (9, 12, 15, 18, 33, 36, 39, 42)]].sum(axis=1)
    k12_pub = acs[[f"B14002_{i:03d}E" for i in (8, 11, 14, 17, 32, 35, 38, 41)]].sum(axis=1)
    private_share = (k12_pri / (k12_pri + k12_pub)).clip(0, 0.6).fillna(0.1)
    enroll_pub = sum(s["enrollment"] for s in schools if s["kind"] == "public")
    enroll_ch = sum(s["enrollment"] for s in schools if s["kind"] == "charter")
    enroll_pr = sum(s["enrollment"] for s in schools if s["kind"] == "private")
    charter_share = enroll_ch / (enroll_pub + enroll_ch + enroll_pr)
    print("enrollment public", enroll_pub, "charter", enroll_ch, "private", enroll_pr)

    # Students per block by school: zoned public schools by grade band; charter/private by gravity.
    xs = np.array([s["x"] for s in schools])
    zs = np.array([s["z"] for s in schools])
    alloc = defaultdict(float)  # (school, block) -> students
    asheville_elem = [i for i in pub if schools[i]["district"] == "Asheville City Schools" and (schools[i]["hi"] or 0) <= 5]
    for b, gid in enumerate(blocks_order):
        kids = float(blocks.iloc[b]["age_5_17"])
        if kids <= 0:
            continue
        bx, bz = reps[b].x, reps[b].y
        ps = float(private_share.get(gid[:12], 0.1))
        k_private = kids * ps
        k_charter = kids * charter_share
        k_public = kids - k_private - k_charter
        d = districts[block_district[b]]["properties"]
        bands = [("elem", 6 / 13, d.get("Elementary")), ("mid", 3 / 13, d.get("Middle")), ("high", 4 / 13, d.get("High"))]
        inter = d.get("Intermediate")
        for level, share, nm in bands:
            n = k_public * share
            if level == "elem" and inter:
                i_int = find_school(inter, "int")
                if i_int is not None:
                    alloc[(i_int, b)] += n * 2 / 6  # grades 5-6 of K-5/6
                    n *= 4 / 6
            if level == "elem" and d.get("DESCR") == "ASHEVILLE CITY" and asheville_elem:
                # Asheville City elementary schools take students citywide; nearest school weighted.
                dist = np.hypot(xs[asheville_elem] - bx, zs[asheville_elem] - bz) / 1000
                w = np.array([schools[i]["enrollment"] for i in asheville_elem]) * np.exp(-dist / 2.5)
                for i, ww in zip(asheville_elem, w / w.sum()):
                    alloc[(i, b)] += n * ww
                continue
            i = find_school(nm, level)
            if i is None:
                cand = [j for j in pub if (schools[j]["lo"] or 0) <= {"elem": 3, "mid": 7, "high": 10}[level] <= (schools[j]["hi"] or 12)]
                i = min(cand, key=lambda j: math.hypot(schools[j]["x"] - bx, schools[j]["z"] - bz))
            alloc[(i, b)] += n
        for kind, n, scale in (("charter", k_charter, 6.0), ("private", k_private, 9.0)):
            cand = [j for j, s in enumerate(schools) if s["kind"] == kind and s["enrollment"] > 0]
            dist = np.hypot(xs[cand] - bx, zs[cand] - bz) / 1000
            w = np.array([schools[j]["enrollment"] for j in cand]) * np.exp(-dist / scale)
            if w.sum() <= 0:
                continue
            for j, ww in zip(cand, w / w.sum()):
                if ww * n > 0.01:
                    alloc[(j, b)] += n * ww
    # Scale each school's allocation to its actual enrollment (students from outside the
    # county or modeling error make up the rest; outside students arrive via corridors).
    per_school = defaultdict(float)
    for (i, b), v in alloc.items():
        per_school[i] += v
    s_school, s_block, s_count = [], [], []
    for (i, b), v in alloc.items():
        target = schools[i]["enrollment"]
        f = target / per_school[i] if per_school[i] > 0 else 0
        f = min(f, 3.0)  # don't pretend a tiny catchment fills a big school
        val = v * f
        if val >= 0.05:
            s_school.append(i)
            s_block.append(b)
            s_count.append(val)
    for i, s in enumerate(schools):
        s["modeled_local"] = round(sum(c for j, c in zip(s_school, s_count) if j == i))
    np.savez_compressed(WORK / "demand.npz", od_home=home, od_work=work, od_count=count,
                        sch_school=np.array(s_school, dtype=np.int32), sch_block=np.array(s_block, dtype=np.int32),
                        sch_count=np.array(s_count, dtype=np.float32))
    save_json(WORK / "schools.json", schools, indent=1)
    save_json(WORK / "corridors.json", corridors, indent=1)
    print("school flows", len(s_school), "students modeled", int(sum(s_count)))


if __name__ == "__main__":
    main()

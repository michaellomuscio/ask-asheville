"""Classify every building in Buncombe County and give it households, residents and jobs.

Sources
  footprints  OpenStreetMap (the county's ~187k buildings are fully mapped)
  land use    Buncombe County parcels: property class code (owner, value and sale
              fields are never downloaded)
  people      2020 Census blocks: housing units, occupied units, household and group
              quarters population, tenure, ages
  jobs        LEHD LODES 2023 Workplace Area Characteristics, jobs by census block
  addresses   Buncombe County E911 civic address points

Method (per census block, so every block's totals match the Census exactly)
  1. Kind of building from the parcel's class code, the OSM tag and its size: a house
     is the largest building on a residential parcel, smaller ones are garages/sheds;
     condo and townhome buildings count the unit parcels inside them; apartments get
     units from floor area.
  2. The block's housing units are spread over its residential buildings in proportion
     to those first estimates (largest-remainder rounding), filling apartments first
     when the block has more units than detected and trimming the least certain
     buildings first when it has fewer.
  3. Occupied units follow the block's occupancy rate; household population is split
     so owner-type homes (houses, townhomes, mobile homes) get the block group's
     owner household size and apartments the renter size. Group quarters population
     goes to dorms, nursing homes and the jail.
  4. LODES jobs are spread over the block's non-residential buildings by floor area,
     steering each sector (education, health, retail, food & lodging, manufacturing...)
     to matching building kinds first.

Writes work/buildings.parquet and work/buildings_rings.pkl.
"""
from __future__ import annotations

import gzip
import json
import math
import pickle
from collections import defaultdict

import numpy as np
import pandas as pd
import shapefile
import shapely
from shapely.geometry import Point, Polygon, shape
from shapely.ops import transform

from common import CACHE, WORK, county_shape, project, unproject

# --- Building kinds (codes shipped to the browser) ------------------------------------------
KINDS = ["house", "townhome", "condo", "apartment", "mobile_home", "group_quarters", "hotel",
         "retail", "office", "commercial", "industrial", "warehouse", "school", "university", "church",
         "hospital", "medical", "government", "civic", "recreation", "parking", "farm", "accessory",
         "utility", "mixed_use", "other"]
K = {k: i for i, k in enumerate(KINDS)}
RESIDENTIAL = {"house", "townhome", "condo", "apartment", "mobile_home", "mixed_use"}
OWNER_TYPE = {"house", "townhome", "mobile_home"}


def class_kind(code: str):
    """Buncombe parcel class code -> building kind for the parcel's main building."""
    if not code:
        return None
    if code in ("A", "F", "H", "W", "C"):
        return "farm"
    try:
        c = int(code)
    except ValueError:
        return None
    if c in (100, 101, 105, 180):
        return "house"
    if c in (120, 122):
        return "condo"
    if c == 121:
        return "townhome"
    if c in (170, 173, 416, 458):
        return "mobile_home"
    if c == 250:
        return "civic"  # Biltmore Estate
    if c in (411, 442, 634, 635):
        return "apartment"
    if c in (414, 415, 417, 418):
        return "hotel"
    if c in (476, 631, 633, 644):
        return "group_quarters"
    if c == 670:
        return "group_quarters"
    if c in (300, 301, 305, 306, 311, 315, 317, 320, 340, 341, 365):
        return None  # vacant land classes: decide from OSM/size
    if c in (307, 437, 438, 624, 653):
        return "parking"
    if 420 <= c <= 426 or 450 <= c <= 458 or 490 <= c <= 495 or c in (400, 401, 405, 481):
        return "retail"
    if 460 <= c <= 468:
        return "office" if c != 468 else "medical"
    if 430 <= c <= 436 or 470 <= c <= 479 or c in (486,):
        return "commercial" if c != 486 else "school"
    if c in (440, 441, 442, 444, 445, 446, 447):
        return "warehouse"
    if c in (448,):
        return "industrial"
    if c in (480, 483):
        return "mixed_use"
    if 500 <= c <= 599:
        return "recreation"
    if c in (612, 614, 615, 616, 617, 610, 623):
        return "school"
    if c == 613:
        return "university"
    if c in (620, 621, 622, 625, 628):
        return "church"
    if c in (640, 641, 645, 656):
        return "hospital"
    if c in (642, 646):
        return "medical"
    if c in (650, 651, 652, 654, 658, 660, 661, 662):
        return "government"
    if c in (600, 601, 602, 611, 618, 630, 632, 636, 680, 681, 682, 694, 695):
        return "civic"
    if 700 <= c <= 799:
        return "industrial"
    if 800 <= c <= 899:
        return "utility"
    if 900 <= c <= 999:
        return "recreation"
    return None


OSM_KIND = {
    "house": "house", "detached": "house", "semidetached_house": "house", "bungalow": "house", "cabin": "house",
    "farmhouse": "house", "residential": None, "terrace": "townhome", "townhouse": "townhome", "apartments": "apartment",
    "dormitory": "group_quarters", "static_caravan": "mobile_home", "mobile_home": "mobile_home", "hotel": "hotel",
    "retail": "retail", "supermarket": "retail", "kiosk": "retail", "commercial": "commercial", "office": "office",
    "industrial": "industrial", "manufacture": "industrial", "warehouse": "warehouse", "storage_tank": "utility",
    "school": "school", "kindergarten": "school", "college": "university", "university": "university",
    "church": "church", "chapel": "church", "cathedral": "church", "mosque": "church", "synagogue": "church",
    "temple": "church", "religious": "church", "hospital": "hospital", "civic": "civic", "public": "civic",
    "government": "government", "fire_station": "government", "train_station": "civic", "transportation": "civic",
    "stadium": "recreation", "grandstand": "recreation", "sports_hall": "recreation", "sports_centre": "recreation",
    "parking": "parking", "garage": "accessory", "garages": "accessory", "carport": "accessory", "shed": "accessory",
    "roof": "accessory", "hut": "accessory", "barn": "farm", "farm_auxiliary": "farm", "greenhouse": "farm",
    "stable": "farm", "cowshed": "farm", "silo": "farm", "construction": "other", "service": "utility",
    "water_tower": "utility", "toilets": "accessory", "boathouse": "accessory",
}

# Floor area per job by kind (m^2/job), used to weight LODES jobs within a block.
M2_PER_JOB = {"office": 25, "medical": 30, "hospital": 35, "retail": 55, "commercial": 60, "mixed_use": 45, "hotel": 70,
              "school": 90, "university": 70, "government": 35, "civic": 120, "church": 400, "recreation": 150,
              "industrial": 90, "warehouse": 180, "utility": 300, "farm": 1500, "parking": 4000, "group_quarters": 80,
              "other": 150}
# LODES sector columns -> preferred building kinds.
SECTORS = {
    "CNS15": ("school", "university"),  # educational services
    "CNS16": ("hospital", "medical", "group_quarters"),  # health care & social assistance
    "CNS07": ("retail", "mixed_use", "commercial"),  # retail trade
    "CNS18": ("hotel", "retail", "mixed_use", "commercial"),  # accommodation & food services
    "CNS05": ("industrial", "warehouse"),  # manufacturing
    "CNS08": ("warehouse", "industrial", "commercial"),  # transportation & warehousing
    "CNS06": ("warehouse", "commercial", "industrial"),  # wholesale
    "CNS20": ("government", "civic", "office"),  # public administration
    "CNS17": ("recreation", "civic", "hotel"),  # arts, entertainment, recreation
}


def largest_remainder(weights, total):
    """Integers proportional to weights that sum exactly to total."""
    w = np.asarray(weights, dtype=np.float64)
    if total <= 0 or w.sum() <= 0:
        return np.zeros(len(w), dtype=np.int64)
    q = w / w.sum() * total
    base = np.floor(q).astype(np.int64)
    rem = int(total - base.sum())
    if rem > 0:
        order = np.argsort(-(q - base), kind="stable")
        base[order[:rem]] += 1
    return base


def to_m(geom):
    return transform(lambda x, y, z=None: project(x, y), geom)


def load_terrain():
    t = np.load(WORK / "terrain.npz")
    return t["height"], float(t["x0"]), float(t["z0"]), float(t["cell"])


def main():
    county = county_shape()
    county_m = to_m(county)
    H, tx0, tz0, tcell = load_terrain()

    def ground(x, z):
        fx = (np.asarray(x) - tx0) / tcell
        fz = (np.asarray(z) - tz0) / tcell
        ix = np.clip(np.floor(fx).astype(int), 0, H.shape[1] - 2)
        iz = np.clip(np.floor(fz).astype(int), 0, H.shape[0] - 2)
        ax = np.clip(fx - ix, 0, 1)
        az = np.clip(fz - iz, 0, 1)
        return (H[iz, ix] * (1 - ax) * (1 - az) + H[iz, ix + 1] * ax * (1 - az)
                + H[iz + 1, ix] * (1 - ax) * az + H[iz + 1, ix + 1] * ax * az)

    # --- Footprints ---------------------------------------------------------------------------
    raw = pickle.load(open(WORK / "osm_buildings.pkl", "rb"))
    polys, tags, osm_ids = [], [], []
    for b in raw:
        for ring, holes in b["polys"]:
            if len(ring) < 4:
                continue
            xs, zs = project([p[0] for p in ring], [p[1] for p in ring])
            poly = Polygon(np.column_stack([xs, zs]))
            if not poly.is_valid:
                poly = poly.buffer(0)
                if poly.geom_type == "MultiPolygon":
                    poly = max(poly.geoms, key=lambda g: g.area)
            if poly.is_empty or poly.area < 6:
                continue
            polys.append(poly)
            tags.append(b["tags"])
            osm_ids.append(b["osm"])
    polys = np.array(polys, dtype=object)
    cent = shapely.centroid(polys)
    inside = shapely.contains(county_m, cent)
    polys, cent = polys[inside], cent[inside]
    tags = [t for t, k in zip(tags, inside) if k]
    osm_ids = [o for o, k in zip(osm_ids, inside) if k]
    n = len(polys)
    area = shapely.area(polys)
    cx = shapely.get_x(cent)
    cz = shapely.get_y(cent)
    print("buildings in county", n)

    # --- Parcels -------------------------------------------------------------------------------
    parcels, pclass, pacres = [], [], []
    with open(CACHE / "county" / "parcels.ndjson") as f:
        for line in f:
            ft = json.loads(line)
            g = ft.get("geometry")
            if not g:
                continue
            try:
                geom = to_m(shape(g))
            except Exception:  # noqa: BLE001
                continue
            if not geom.is_valid:
                geom = geom.buffer(0)
            parcels.append(geom)
            pr = ft["properties"]
            pclass.append((pr.get("Class") or "").strip())
            pacres.append(pr.get("Acreage") or 0)
    parcels = np.array(parcels, dtype=object)
    pclass = np.array(pclass, dtype=object)
    ptree = shapely.STRtree(parcels)
    bi, pi = ptree.query(cent, predicate="within")
    parcel_of = -np.ones(n, dtype=np.int64)
    # A centroid can fall in stacked condo parcels; prefer the non-condo (base) parcel.
    for b, p in zip(bi, pi):
        cur = parcel_of[b]
        if cur < 0 or (pclass[cur] in ("120", "121", "122") and pclass[p] not in ("120", "121", "122")):
            parcel_of[b] = p
    missing = np.where(parcel_of < 0)[0]
    if len(missing):
        near_b, near_p = ptree.query_nearest(cent[missing], max_distance=15, return_distance=False)
        parcel_of[missing[near_b]] = near_p
    print("buildings matched to parcels", int((parcel_of >= 0).sum()))

    # Condo / townhome unit parcels inside each building footprint.
    unit_mask = np.isin(pclass, ["120", "121"])
    unit_idx = np.where(unit_mask)[0]
    unit_pts = shapely.point_on_surface(parcels[unit_idx])
    btree = shapely.STRtree(polys)
    ub, bb = btree.query(unit_pts, predicate="within")
    unit_parcels_in = np.zeros(n, dtype=np.int64)
    np.add.at(unit_parcels_in, bb, 1)

    # --- Address points -----------------------------------------------------------------------
    a_x, a_z, a_label = [], [], []
    with open(CACHE / "county" / "addresses.ndjson") as f:
        for line in f:
            ft = json.loads(line)
            g = ft.get("geometry")
            if not g:
                continue
            lon, lat = g["coordinates"][:2]
            x, z = project(lon, lat)
            a_x.append(float(x))
            a_z.append(float(z))
            pr = ft["properties"]
            a_label.append(f"{(pr.get('FullCivicAddress') or '').strip()}|{pr.get('ZipCode') or ''}")
    a_pts = shapely.points(np.column_stack([a_x, a_z]))
    ab, bb2 = btree.query(a_pts, predicate="within")
    addr_count = np.zeros(n, dtype=np.int64)
    np.add.at(addr_count, bb2, 1)
    first_addr = {}
    for a, b in zip(ab, bb2):
        first_addr.setdefault(int(b), a_label[a])
    # Addresses not inside any footprint: snap to the nearest building within 40 m.
    hit = np.zeros(len(a_pts), dtype=bool)
    hit[ab] = True
    rest = np.where(~hit)[0]
    nb_a, nb_b = btree.query_nearest(a_pts[rest], max_distance=40, return_distance=False)
    for a, b in zip(rest[nb_a], nb_b):
        addr_count[b] += 1
        first_addr.setdefault(int(b), a_label[a])
    print("addresses", len(a_pts), "inside footprints", int(hit.sum()))

    # --- Census blocks --------------------------------------------------------------------------
    sf = shapefile.Reader(str(CACHE / "tiger/tl_2020_37021_tabblock20/tl_2020_37021_tabblock20.shp"))
    blk_geoid, blk_geom = [], []
    for rec, shp in zip(sf.records(), sf.shapes()):
        blk_geoid.append(rec["GEOID20"])
        blk_geom.append(to_m(shape(shp.__geo_interface__)))
    blk_geom = np.array(blk_geom, dtype=object)
    blk_index = {g: i for i, g in enumerate(blk_geoid)}
    blocks = pd.read_parquet(CACHE / "census" / "blocks_2020.parquet").set_index("geoid").reindex(blk_geoid).fillna(0)
    ktree = shapely.STRtree(blk_geom)
    kb, kk = ktree.query(cent, predicate="within")
    block_of = -np.ones(n, dtype=np.int64)
    block_of[kb] = kk
    miss = np.where(block_of < 0)[0]
    if len(miss):
        mb, mk = ktree.query_nearest(cent[miss], return_distance=False)
        block_of[miss[mb]] = mk
    print("blocks", len(blk_geoid), "with buildings", len(set(block_of.tolist())))

    # Block-group household sizes by tenure (ACS 2020-24) for owner vs renter homes.
    acs = pd.read_parquet(CACHE / "census" / "acs_bg_extra.parquet").set_index("geoid")
    bg_owner_pph = acs["B25010_002E"].to_dict()
    bg_renter_pph = acs["B25010_003E"].to_dict()

    # --- Classification ------------------------------------------------------------------------------
    kind = np.empty(n, dtype=object)
    pc_of = np.array([pclass[p] if p >= 0 else "" for p in parcel_of], dtype=object)
    by_parcel = defaultdict(list)
    for i, p in enumerate(parcel_of):
        if p >= 0:
            by_parcel[int(p)].append(i)
    rank_on_parcel = np.zeros(n, dtype=np.int64)
    n_on_parcel = np.ones(n, dtype=np.int64)
    for p, idx in by_parcel.items():
        idx.sort(key=lambda i: -area[i])
        for r, i in enumerate(idx):
            rank_on_parcel[i] = r
            n_on_parcel[i] = len(idx)

    for i in range(n):
        t = tags[i]
        osm_k = OSM_KIND.get(t.get("building", "yes"))
        if t.get("amenity") in ("school", "kindergarten"):
            osm_k = "school"
        elif t.get("amenity") in ("place_of_worship",):
            osm_k = "church"
        elif t.get("amenity") in ("hospital",):
            osm_k = "hospital"
        elif t.get("amenity") in ("fire_station", "police", "townhall", "courthouse"):
            osm_k = "government"
        pk = class_kind(pc_of[i])
        a = area[i]
        r = rank_on_parcel[i]
        k = None
        if osm_k in ("accessory", "farm", "utility", "parking"):
            k = osm_k
        elif pk in ("house", "mobile_home"):
            code = pc_of[i]
            if a < 35:
                k = "accessory"
            elif r == 0 or (code == "180" and a >= 55) or (pk == "mobile_home" and a >= 40 and code in ("416", "173")):
                k = osm_k if osm_k in ("townhome", "apartment") else pk
            elif addr_count[i] >= 1 and a >= 45:
                k = "house"  # second dwelling with its own address
            else:
                k = "accessory"
        elif pk in ("condo", "townhome"):
            k = pk if a >= 40 else "accessory"
        elif pk == "apartment":
            k = "apartment" if a >= 120 or r == 0 else ("accessory" if a < 60 else "apartment")
        elif pk == "farm":
            if r == 0 and a >= 60 and (osm_k in (None, "house")):
                k = "house"  # farmhouse on present-use farmland
            elif a < 35:
                k = "accessory"
            else:
                k = "farm" if osm_k is None else osm_k
        elif pk is not None:
            k = pk if a >= 25 else "accessory"
            if osm_k in ("school", "church", "hospital", "university", "hotel") and pk in ("civic", "government", "commercial", "retail", "other"):
                k = osm_k
        else:
            # Vacant-land classes or no parcel: fall back to the OSM tag and size.
            if osm_k:
                k = osm_k
            elif a < 30:
                k = "accessory"
            elif a < 400:
                k = "house" if r == 0 else ("accessory" if a < 70 else "house")
            else:
                k = "commercial"
        kind[i] = k or "other"
    # Condo/townhome buildings mapped on non-condo parcels (common): the unit parcels decide.
    for i in np.where(unit_parcels_in >= 2)[0]:
        if kind[i] in ("house", "apartment", "other", "commercial", "mixed_use"):
            kind[i] = "townhome" if unit_parcels_in[i] <= 8 and area[i] < 1200 else "condo"

    # --- Floors and heights --------------------------------------------------------------------------
    def num(v):
        try:
            return float(str(v).split(";")[0].replace("m", "").strip())
        except (TypeError, ValueError):
            return None

    d_downtown = np.hypot(cx, cz)
    floors = np.ones(n, dtype=np.float64)
    height = np.zeros(n, dtype=np.float64)
    h32 = np.array([(hash(o) & 0xFFFF) / 65535.0 for o in osm_ids])
    for i in range(n):
        t = tags[i]
        k = kind[i]
        a = area[i]
        lv = num(t.get("building:levels")) or num(t.get("levels"))
        hh = num(t.get("height"))
        if lv is None:
            if k == "house":
                lv = 1 if a < 110 else (2 if a > 190 or h32[i] > 0.55 else 1)
            elif k in ("townhome",):
                lv = 2
            elif k in ("condo", "apartment"):
                lv = 2 if a < 300 else 3 if a < 1400 else 4
                if d_downtown[i] < 900:
                    lv = max(lv, 4 if a > 600 else 3)
            elif k in ("office", "mixed_use", "government"):
                lv = 2 if a < 800 else 3
                if d_downtown[i] < 700:
                    lv = 3 + (2 if a > 1200 else 0)
            elif k in ("hospital",):
                lv = 3 if a < 4000 else 5
            elif k in ("hotel",):
                lv = 2 if a < 600 else 4
            elif k in ("school", "university"):
                lv = 1 if a < 2500 else 2
            elif k == "group_quarters":
                lv = 2 if a < 800 else 3
            elif k == "parking":
                lv = 1 if a < 1500 else 4
            else:
                lv = 1
        floors[i] = max(1, lv)
        fh = 3.0 if k in RESIDENTIAL or k in ("group_quarters", "hotel") else 4.0
        if k in ("industrial", "warehouse", "retail", "recreation") and floors[i] <= 1:
            fh = 6.5 if a > 1500 else 5.0
        if k in ("accessory", "farm", "utility"):
            fh = 3.4
        height[i] = hh if hh and hh > 2 else floors[i] * fh + (0.6 if k not in ("house", "townhome", "mobile_home") else 0)
        if k == "mobile_home":
            height[i] = 3.6

    # --- Units: first estimates -------------------------------------------------------------------------
    est = np.zeros(n, dtype=np.float64)
    for i in range(n):
        k = kind[i]
        if k == "house":
            est[i] = 1.0 + (0.6 if pc_of[i] == "180" and addr_count[i] > 1 else 0)
        elif k == "mobile_home":
            est[i] = 1.0
        elif k in ("townhome", "condo"):
            from_parcels = unit_parcels_in[i]
            floor_area = area[i] * floors[i]
            est[i] = max(from_parcels, floor_area / (150 if k == "townhome" else 110), 1)
        elif k == "apartment":
            est[i] = max(2.0, area[i] * floors[i] * 0.82 / 85.0)
        elif k == "mixed_use":
            est[i] = max(0.0, area[i] * max(0, floors[i] - 1) * 0.8 / 90.0)

    units = np.zeros(n, dtype=np.int64)
    unplaced_units = 0
    blk_members = defaultdict(list)
    for i, b in enumerate(block_of):
        blk_members[int(b)].append(i)
    for b, idx in blk_members.items():
        idx = np.array(idx)
        U = int(blocks.iloc[b]["units"])
        if U <= 0:
            continue
        e = est[idx].copy()
        C = e.sum()
        ks = kind[idx]
        if C <= 0:
            # Units with no detected dwelling: use the most plausible buildings.
            cand = np.array([kk in ("other", "commercial", "mixed_use", "farm", "accessory") and area[j] >= 40 for kk, j in zip(ks, idx)])
            if not cand.any():
                cand = area[idx] >= 25
            if not cand.any():
                unplaced_units += U
                continue
            e = np.where(cand, area[idx], 0.0)
            units[idx] = largest_remainder(e, U)
            for j in idx[units[idx] > 0]:
                if kind[j] not in RESIDENTIAL:
                    kind[j] = "house" if units[j] == 1 else "apartment"
            continue
        if U > C:
            extra = U - C
            mf = np.isin(ks, ["apartment", "condo", "mixed_use"])
            if mf.any():
                e[mf] += extra * e[mf] / e[mf].sum()
            else:
                sf_ = np.isin(ks, ["house", "townhome", "mobile_home"])
                add = np.minimum(extra * e / C, 2.0 * e)
                e += np.where(sf_, add, 0)
                left = U - e.sum()
                if left > 0.5:
                    # Still short: likely unmapped apartments/ADUs; widen the pool.
                    pool = np.array([kk in ("other", "commercial", "accessory") and area[j] >= 45 for kk, j in zip(ks, idx)])
                    if pool.any():
                        e = e + np.where(pool, left * area[idx] / area[idx][pool].sum(), 0)
                    else:
                        e *= U / e.sum()
        elif U < C:
            # Fewer units than detected dwellings: drop the least certain first.
            surplus = C - U
            order = sorted(range(len(idx)), key=lambda q: (0 if (pc_of[idx[q]] == "" and ks[q] == "house") else
                                                            1 if ks[q] == "house" and rank_on_parcel[idx[q]] > 0 else
                                                            2 if ks[q] == "mixed_use" else 3, area[idx[q]]))
            for q in order:
                if surplus <= 0.5:
                    break
                if ks[q] in ("house", "mobile_home") and e[q] <= 1.6:
                    if (pc_of[idx[q]] == "" or rank_on_parcel[idx[q]] > 0 or ks[q] == "mobile_home") and surplus >= 1:
                        surplus -= e[q]
                        e[q] = 0
                elif ks[q] == "mixed_use":
                    cut = min(e[q], surplus)
                    e[q] -= cut
                    surplus -= cut
            if e.sum() > U:
                e *= U / e.sum()
        units[idx] = largest_remainder(e, U)
    for i in np.where((units == 0) & np.isin(kind, ["house", "mobile_home", "townhome", "condo", "apartment"]))[0]:
        # Detected dwellings left without a census unit: second homes on the same lot,
        # garages misread as houses... Mark them as accessory so nobody lives there.
        if kind[i] in ("house", "mobile_home"):
            kind[i] = "accessory" if area[i] < 90 else "other"
    print("units placed", int(units.sum()), "of", int(blocks["units"].sum()), "unplaced", unplaced_units)

    # --- Households and residents -----------------------------------------------------------------------------
    households = np.zeros(n, dtype=np.int64)
    residents = np.zeros(n, dtype=np.int64)
    gq_res = np.zeros(n, dtype=np.int64)
    kids = np.zeros(n, dtype=np.float64)
    seniors = np.zeros(n, dtype=np.float64)
    unplaced_people = 0
    for b, idx in blk_members.items():
        idx = np.array(idx)
        row = blocks.iloc[b]
        U = int(row["units"])
        O = int(row["occupied"])
        HP = int(row["pop"] - row["gq"])
        if U > 0 and O > 0:
            occ = largest_remainder(units[idx], O)
            households[idx] = occ
            bg = blk_geoid[b][:12]
            own = bg_owner_pph.get(bg) or 2.4
            rent = bg_renter_pph.get(bg) or 2.0
            if not (own > 0):
                own = 2.4
            if not (rent > 0):
                rent = 2.0
            w = np.array([occ[q] * (own if kind[j] in OWNER_TYPE else rent) for q, j in enumerate(idx)], dtype=np.float64)
            if w.sum() > 0 and HP > 0:
                residents[idx] = largest_remainder(w, HP)
        elif HP > 0:
            unplaced_people += HP
        G = int(row["gq"])
        if G > 0:
            gq_b = [j for j in idx if kind[j] in ("group_quarters", "university", "hospital")]
            if not gq_b:
                gq_b = [j for j in idx if kind[j] not in ("accessory", "parking", "farm", "utility")] or list(idx)
            gq_b = np.array(gq_b)
            gq_res[gq_b] += largest_remainder(area[gq_b], G)
        tot = residents[idx] + gq_res[idx]
        if row["pop"] > 0 and tot.sum() > 0:
            kids[idx] = tot * row["age_5_17"] / row["pop"]
            seniors[idx] = tot * row["age_65p"] / row["pop"]
    # Census 2020 block counts carry differential-privacy noise: some blocks report people
    # but no occupied homes. Their household population goes to homes elsewhere in the
    # same block group, in proportion to households, so county totals stay exact.
    bg_of_building = np.array([blk_geoid[b][:12] for b in block_of], dtype=object)
    orphan = defaultdict(int)
    for b, idx in blk_members.items():
        row = blocks.iloc[b]
        HP = int(row["pop"] - row["gq"])
        if HP > 0 and residents[np.array(idx)].sum() == 0:
            orphan[blk_geoid[b][:12]] += HP
    for b in set(range(len(blk_geoid))) - set(blk_members):
        row = blocks.iloc[b]
        HP = int(row["pop"] - row["gq"])
        if HP > 0:
            orphan[blk_geoid[b][:12]] += HP
    for bg, extra in orphan.items():
        idx = np.where((bg_of_building == bg) & (households > 0))[0]
        if len(idx) == 0:
            idx = np.where(bg_of_building == bg)[0]
        if len(idx):
            w = households[idx].astype(np.float64) + 0.01
            residents[idx] += largest_remainder(w, extra)
            unplaced_people -= extra
    residents_all = residents + gq_res
    print("residents placed", int(residents_all.sum()), "of", int(blocks["pop"].sum()), "still unplaced", unplaced_people)

    # --- Jobs (LODES WAC 2023) ------------------------------------------------------------------------------------
    wac = pd.read_csv(CACHE / "lodes" / "nc_wac_S000_JT00_2023.csv.gz", dtype={"w_geocode": str})
    wac = wac[wac.w_geocode.str.startswith("37021")].set_index("w_geocode")
    jobs = np.zeros(n, dtype=np.float64)
    unplaced_jobs = 0
    nonres_kinds = {"retail", "office", "commercial", "industrial", "warehouse", "school", "university", "church",
                    "hospital", "medical", "government", "civic", "recreation", "hotel", "mixed_use", "group_quarters",
                    "utility", "farm", "other", "parking"}
    for geoid, row in wac.iterrows():
        b = blk_index.get(geoid)
        total = int(row["C000"])
        if b is None or total <= 0:
            unplaced_jobs += max(total, 0)
            continue
        idx = np.array(blk_members.get(b, []), dtype=np.int64)
        if len(idx) == 0:
            unplaced_jobs += total
            continue
        cap = np.array([area[j] * floors[j] / M2_PER_JOB.get(kind[j], 400) if kind[j] in nonres_kinds else 0.0 for j in idx])
        alloc = np.zeros(len(idx))
        remaining = float(total)
        for col, prefer in SECTORS.items():
            v = float(row.get(col, 0) or 0)
            if v <= 0:
                continue
            m = np.array([kind[j] in prefer for j in idx])
            if m.any() and cap[m].sum() > 0:
                alloc[m] += v * cap[m] / cap[m].sum()
                remaining -= v
        if remaining > 0:
            if cap.sum() > 0:
                alloc += remaining * cap / cap.sum()
            else:
                # Home-based businesses, farms: spread over the block's buildings.
                w = np.where(np.isin(kind[idx], ["accessory"]), 0.2, 1.0) * area[idx]
                alloc += remaining * w / w.sum()
        jobs[idx] += alloc
    # Jobs in blocks with no buildings: spread over the block group's job sites.
    bg_jobs = defaultdict(float)
    for geoid, row in wac.iterrows():
        b = blk_index.get(geoid)
        if b is None or not blk_members.get(b):
            bg_jobs[geoid[:12]] += float(row["C000"])
    for bg, v in bg_jobs.items():
        idx = np.where((bg_of_building == bg) & (jobs > 0))[0]
        if len(idx):
            jobs[idx] += v * jobs[idx] / jobs[idx].sum()
            unplaced_jobs -= v
    jobs_i = np.zeros(n, dtype=np.int64)
    for b, idx in blk_members.items():
        idx = np.array(idx)
        t = int(round(jobs[idx].sum()))
        if t > 0:
            jobs_i[idx] = largest_remainder(jobs[idx], t)
    print("jobs placed", int(jobs_i.sum()), "of", int(wac["C000"].sum()), "unplaced", unplaced_jobs)

    # --- Footprint simplification and ground ---------------------------------------------------------------------------
    rings = []
    base = np.zeros(n, dtype=np.float32)
    roof = np.zeros(n, dtype=np.uint8)  # 0 flat, 1 gable (houses with near-rectangular footprints)
    gable_dir = np.zeros(n, dtype=np.float32)
    for i in range(n):
        p = polys[i].simplify(0.35, preserve_topology=True)
        if p.is_empty or p.geom_type != "Polygon":
            p = polys[i]
        p = shapely.orient_polygons(p) if hasattr(shapely, "orient_polygons") else shapely.geometry.polygon.orient(p, 1.0)
        coords = np.asarray(p.exterior.coords)[:-1]
        if len(coords) > 64:
            coords = np.asarray(polys[i].simplify(1.2, preserve_topology=True).exterior.coords)[:-1]
        rings.append(coords.astype(np.float32))
        g = ground(coords[:, 0], coords[:, 1])
        base[i] = float(g.min())
        if kind[i] in ("house", "townhome", "mobile_home", "farm", "accessory", "church") and area[i] < 900:
            mrr = polys[i].minimum_rotated_rectangle
            if mrr.area > 0 and polys[i].area / mrr.area > 0.82:
                roof[i] = 1
                c = np.asarray(mrr.exterior.coords)
                e1 = c[1] - c[0]
                e2 = c[2] - c[1]
                long_edge = e1 if np.hypot(*e1) >= np.hypot(*e2) else e2
                gable_dir[i] = math.atan2(long_edge[1], long_edge[0])

    # --- Names for notable buildings ---------------------------------------------------------------------------------
    name = [t.get("name") or "" for t in tags]
    addr = [first_addr.get(i, "") for i in range(n)]

    df = pd.DataFrame({
        "osm": osm_ids, "x": cx.astype(np.float32), "z": cz.astype(np.float32), "area": area.astype(np.float32),
        "kind": [K[k] for k in kind], "parcel_class": pc_of, "floors": floors.astype(np.float32),
        "height": height.astype(np.float32), "base": base, "roof": roof, "gable_dir": gable_dir,
        "units": units, "households": households, "residents": residents_all, "gq": gq_res,
        "kids": kids.astype(np.float32), "seniors": seniors.astype(np.float32), "jobs": jobs_i,
        "block": block_of, "addr_count": addr_count, "name": name, "addr": addr,
    })
    df.to_parquet(WORK / "buildings.parquet", index=False)
    pickle.dump(rings, open(WORK / "buildings_rings.pkl", "wb"), protocol=pickle.HIGHEST_PROTOCOL)
    pd.DataFrame({"geoid": blk_geoid}).to_parquet(WORK / "block_order.parquet", index=False)
    pickle.dump([g for g in blk_geom], open(WORK / "blocks_m.pkl", "wb"), protocol=pickle.HIGHEST_PROTOCOL)
    # Address search index (civic addresses only).
    with gzip.open(WORK / "addresses.json.gz", "wt") as f:
        json.dump({"x": [round(v, 1) for v in a_x], "z": [round(v, 1) for v in a_z], "label": a_label}, f)
    summary = df.groupby("kind").agg(n=("kind", "size"), units=("units", "sum"), residents=("residents", "sum"),
                                     jobs=("jobs", "sum"))
    summary.index = [KINDS[i] for i in summary.index]
    print(summary.sort_values("n", ascending=False).to_string())


if __name__ == "__main__":
    main()

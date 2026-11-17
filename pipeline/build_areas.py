"""Area layers for the map: Census blocks and block groups.

- Block groups (168): ACS 2020-2024 5-year measures (income, education, household size, age,
  housing, commuting, poverty, race and ethnicity...).
- Blocks (4,841): 2020 Census counts (density, children, seniors, household size, renters,
  vacancy) and LODES jobs.

The browser colors areas through an id raster rather than polygons: every 20 m cell of the county
stores its block index (R + 256 G) and its ZIP code index (B; kept for reference, no ZIP measures
are published). Blocks nest inside block groups, so one raster serves both.

Writes docs/data/areas.json and docs/data/areas_id.png (+ work/zcta_m.pkl).
"""
from __future__ import annotations

import math
import pickle

import numpy as np
import pandas as pd
import shapefile
import shapely
from PIL import Image, ImageDraw
from shapely.geometry import shape
from shapely.ops import transform

from common import CACHE, OUT, WORK, county_shape, project, save_json

CELL = 20.0


def to_m(g):
    return transform(lambda x, y, z=None: project(x, y), g)


def safe_div(a, b):
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where(b > 0, a / b, np.nan)
    return r


def cols(df, table, nums):
    return df[[f"{table}_{i:03d}E" for i in nums]].sum(axis=1)


METRICS = []


def metric(mid, label, group, geo, unit, values, source, note=""):
    v = [None if (x is None or (isinstance(x, float) and (math.isnan(x) or math.isinf(x)))) else round(float(x), 4) for x in values]
    METRICS.append({"id": mid, "label": label, "group": group, "geo": geo, "unit": unit, "source": source, "note": note})
    return v


def main():
    county_m = to_m(county_shape())
    blocks_order = pd.read_parquet(WORK / "block_order.parquet").geoid.tolist()
    blk_geom = pickle.load(open(WORK / "blocks_m.pkl", "rb"))
    blocks = pd.read_parquet(CACHE / "census" / "blocks_2020.parquet").set_index("geoid").reindex(blocks_order).fillna(0)
    bld = pd.read_parquet(WORK / "buildings.parquet")

    bg_ids = sorted({g[:12] for g in blocks_order})
    bg_index = {g: i for i, g in enumerate(bg_ids)}
    block_bg = np.array([bg_index[g[:12]] for g in blocks_order], dtype=np.int32)

    # --- Block group metrics (ACS 2020-2024) -----------------------------------------------------------
    a = pd.read_parquet(CACHE / "census" / "acs_bg_core.parquet")
    a = a[a.county == "021"].set_index("geoid")
    e = pd.read_parquet(CACHE / "census" / "acs_bg_extra.parquet").set_index("geoid")
    df = a.join(e, rsuffix="_x").reindex(bg_ids)
    src = "ACS 2020-2024 5-year"
    pop = df["B01001_001E"]
    land_km2 = np.zeros(len(bg_ids))
    for g, geom in zip(blocks_order, blk_geom):
        land_km2[bg_index[g[:12]]] += geom.area / 1e6
    kids = cols(df, "B01001", [3, 4, 5, 6, 27, 28, 29, 30])
    senior = cols(df, "B01001", list(range(20, 26)) + list(range(44, 50)))
    bach = cols(df, "B15003", [22, 23, 24, 25])
    grad = cols(df, "B15003", [23, 24, 25])
    inc100 = cols(df, "B19001", [14, 15, 16, 17])
    inc_lo = cols(df, "B19001", [2, 3, 4, 5, 6, 7])
    long_commute = cols(df, "B08303", [8, 9, 10, 11, 12, 13])
    early = cols(df, "B08302", [2, 3, 4, 5, 6])  # leave home before 7:00
    bgm = {"geoid": bg_ids}
    bgm["median_income"] = metric("median_income", "Median household income", "Income", "bg", "usd", df["B19013_001E"], src)
    bgm["per_capita_income"] = metric("per_capita_income", "Per capita income", "Income", "bg", "usd", df["B19301_001E"], src)
    bgm["pct_hh_100k"] = metric("pct_hh_100k", "Households earning $100K+", "Income", "bg", "pct", safe_div(inc100, df["B19001_001E"]), src)
    bgm["pct_hh_under_35k"] = metric("pct_hh_under_35k", "Households earning under $35K", "Income", "bg", "pct", safe_div(inc_lo, df["B19001_001E"]), src)
    bgm["pct_poverty"] = metric("pct_poverty", "Below the poverty line", "Income", "bg", "pct", safe_div(df["C17002_002E"] + df["C17002_003E"], df["C17002_001E"]), src)
    bgm["pct_bachelors"] = metric("pct_bachelors", "Bachelor's degree or higher (25+)", "Education", "bg", "pct", safe_div(bach, df["B15003_001E"]), src)
    bgm["pct_graduate"] = metric("pct_graduate", "Graduate or professional degree (25+)", "Education", "bg", "pct", safe_div(grad, df["B15003_001E"]), src)
    bgm["avg_household_size"] = metric("avg_household_size", "Average household size", "Households", "bg", "num", df["B25010_001E"], src)
    bgm["pct_hh_kids"] = metric("pct_hh_kids", "Households with children under 18", "Households", "bg", "pct", safe_div(df["B11005_002E"], df["B11005_001E"]), src)
    bgm["pct_renter"] = metric("pct_renter", "Renter-occupied homes", "Housing", "bg", "pct", safe_div(df["B25003_003E"], df["B25003_001E"]), src)
    bgm["median_home_value"] = metric("median_home_value", "Median home value", "Housing", "bg", "usd", df["B25077_001E"], src)
    bgm["median_rent"] = metric("median_rent", "Median gross rent", "Housing", "bg", "usd", df["B25064_001E"], src)
    bgm["median_year_built"] = metric("median_year_built", "Median year homes were built", "Housing", "bg", "year", df["B25035_001E"].where(df["B25035_001E"] > 1800), src)
    bgm["pct_seasonal"] = metric("pct_seasonal", "Homes held for seasonal or occasional use", "Housing", "bg", "pct", safe_div(df["B25004_006E"], df["B25001_001E"]), src,
                                 "Second homes and similar (Census 'seasonal, recreational, or occasional use' vacancy).")
    bgm["pct_single_family"] = metric("pct_single_family", "Homes in single-family detached houses", "Housing", "bg", "pct", safe_div(df["B25024_002E"], df["B25024_001E"]), src)
    bgm["pct_apartments"] = metric("pct_apartments", "Homes in buildings with 5+ units", "Housing", "bg", "pct",
                                   safe_div(df[["B25024_006E", "B25024_007E", "B25024_008E", "B25024_009E"]].sum(axis=1), df["B25024_001E"]), src)
    bgm["pct_mobile"] = metric("pct_mobile", "Homes that are mobile homes", "Housing", "bg", "pct", safe_div(df["B25024_010E"], df["B25024_001E"]), src)
    bgm["population"] = metric("population", "Population", "Population", "bg", "num", pop, src)
    bgm["density"] = metric("density", "People per square mile", "Population", "bg", "num", safe_div(pop, land_km2 / 2.58999), src)
    bgm["median_age"] = metric("median_age", "Median age", "Population", "bg", "years", df["B01002_001E"], src)
    bgm["pct_under_18"] = metric("pct_under_18", "Residents under 18", "Population", "bg", "pct", safe_div(kids, pop), src)
    bgm["pct_65_plus"] = metric("pct_65_plus", "Residents 65 and older", "Population", "bg", "pct", safe_div(senior, pop), src)
    bgm["pct_hispanic"] = metric("pct_hispanic", "Hispanic or Latino", "Population", "bg", "pct", safe_div(df["B03002_012E"], df["B03002_001E"]), src)
    bgm["pct_black"] = metric("pct_black", "Black (not Hispanic)", "Population", "bg", "pct", safe_div(df["B03002_004E"], df["B03002_001E"]), src)
    bgm["pct_commute_30"] = metric("pct_commute_30", "Commutes of 30+ minutes", "Commuting", "bg", "pct", safe_div(long_commute, df["B08303_001E"]), src)
    bgm["pct_wfh"] = metric("pct_wfh", "Work from home", "Commuting", "bg", "pct", safe_div(df["B08301_021E"], df["B08301_001E"]), src)
    bgm["pct_drive_alone"] = metric("pct_drive_alone", "Drive alone to work", "Commuting", "bg", "pct", safe_div(df["B08301_003E"], df["B08301_001E"]), src)
    bgm["pct_leave_before_7"] = metric("pct_leave_before_7", "Commuters leaving home before 7:00", "Commuting", "bg", "pct", safe_div(early, df["B08302_001E"]), src)
    bgm["pct_no_vehicle"] = metric("pct_no_vehicle", "Households without a vehicle", "Commuting", "bg", "pct", safe_div(df["B25044_003E"] + df["B25044_010E"], df["B25044_001E"]), src)

    # Departure-time distribution per block group (for the trip model), from B08302.
    leave_cols = [f"B08302_{i:03d}E" for i in range(2, 16)]
    tr = pd.read_parquet(CACHE / "census" / "acs_tract_extra.parquet").set_index("tract_geoid")
    leave = []
    for g in bg_ids:
        v = df.loc[g, leave_cols].to_numpy(dtype=np.float64)
        if not np.isfinite(v).all() or v.sum() < 40:
            v = tr.loc[g[:11], leave_cols].to_numpy(dtype=np.float64)
        leave.append([int(x) for x in np.nan_to_num(v)])
    mode = []
    for g in bg_ids:
        r = df.loc[g]
        tot = r["B08301_001E"] or 0
        if not tot or tot < 30:
            r = tr.loc[g[:11]]
            tot = r["B08301_001E"]
        mode.append({"drive_alone": round(float(r["B08301_003E"] / tot), 3) if tot else 0.78,
                     "carpool": round(float(r["B08301_004E"] / tot), 3) if tot else 0.09,
                     "transit": round(float(r["B08301_010E"] / tot), 3) if tot else 0.01,
                     "wfh": round(float(r["B08301_021E"] / tot), 3) if tot else 0.14})

    # --- Block metrics (2020 Census) ---------------------------------------------------------------
    bsrc = "2020 Census (blocks)"
    bk = {}
    land_b = np.array([g.area / 1e6 for g in blk_geom])
    bk["pop"] = blocks["pop"].astype(int).tolist()
    bk["units"] = blocks["units"].astype(int).tolist()
    bk["occupied"] = blocks["occupied"].astype(int).tolist()
    bk["density_b"] = metric("density_b", "People per square mile (block)", "Population", "block", "num", safe_div(blocks["pop"], land_b / 2.58999), bsrc)
    bk["pct_kids_b"] = metric("pct_kids_b", "School-age children 5-17 (block)", "Population", "block", "pct", safe_div(blocks["age_5_17"], blocks["pop"]), bsrc)
    bk["pct_65_b"] = metric("pct_65_b", "Residents 65 and older (block)", "Population", "block", "pct", safe_div(blocks["age_65p"], blocks["pop"]), bsrc)
    bk["hh_size_b"] = metric("hh_size_b", "Average household size (block)", "Households", "block", "num", safe_div(blocks["hh_persons"], blocks["occupied"]), bsrc)
    bk["pct_renter_b"] = metric("pct_renter_b", "Renter-occupied homes (block)", "Housing", "block", "pct", safe_div(blocks["renter"], blocks["occupied"]), bsrc)
    bk["pct_vacant_b"] = metric("pct_vacant_b", "Vacant homes (block)", "Housing", "block", "pct", safe_div(blocks["vacant"], blocks["units"]), bsrc,
                                "Census 2020 block counts include deliberate statistical noise; small blocks can look odd.")
    jobs_by_block = bld.groupby("block").jobs.sum().reindex(range(len(blocks_order))).fillna(0)
    bk["jobs_density_b"] = metric("jobs_density_b", "Jobs per square mile (block)", "Jobs", "block", "num", safe_div(jobs_by_block.to_numpy(), land_b / 2.58999),
                                  "LEHD LODES 2023 (jobs by census block)")

    # --- ZIP codes (areas only) --------------------------------------------------------------------
    zsf = shapefile.Reader(str(CACHE / "tiger/cb_2020_us_zcta520_500k/cb_2020_us_zcta520_500k.shp"))
    zgeo, zids = [], []
    cbox = county_m.bounds
    for rec, shp in zip(zsf.records(), zsf.shapes()):
        z = rec["ZCTA5CE20"]
        if not (z.startswith("287") or z.startswith("288")):
            continue
        g = to_m(shape(shp.__geo_interface__))
        if not g.intersects(county_m):
            continue
        inter = g.intersection(county_m).area
        if inter < 0.02 * g.area and inter < 2e6:
            continue
        zgeo.append(g)
        zids.append(z)
    order = np.argsort(zids)
    zids = [zids[i] for i in order]
    zgeo = [zgeo[i] for i in order]
    zm = {"zip": zids}
    pickle.dump({"zips": zids, "geoms": zgeo}, open(WORK / "zcta_m.pkl", "wb"))

    # --- Id raster ----------------------------------------------------------------------------------------
    x0, z0, x1, z1 = county_m.bounds
    x0 = math.floor((x0 - 1000) / CELL) * CELL
    z0 = math.floor((z0 - 1000) / CELL) * CELL
    W = int(math.ceil((x1 + 1000 - x0) / CELL))
    Hh = int(math.ceil((z1 + 1000 - z0) / CELL))

    def draw(geoms, ids, size):
        img = Image.new("I", size, 0)
        dr = ImageDraw.Draw(img)
        order = np.argsort([-g.area for g in geoms])
        for k in order:
            g = geoms[k]
            parts = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
            for p in parts:
                if p.geom_type != "Polygon" or p.is_empty:
                    continue
                pts = [((x - x0) / CELL, (z - z0) / CELL) for x, z in p.exterior.coords]
                dr.polygon(pts, fill=int(ids[k]))
                for hole in p.interiors:
                    hp = [((x - x0) / CELL, (z - z0) / CELL) for x, z in hole.coords]
                    if len(hp) >= 3:
                        dr.polygon(hp, fill=0)
        return np.array(img, dtype=np.int64)

    blk_ids = draw(blk_geom, np.arange(1, len(blk_geom) + 1), (W, Hh))
    # Holes drawn as 0 can erase enclave blocks: redraw small blocks on top.
    small = [i for i, g in enumerate(blk_geom) if g.area < 2e5]
    redraw = draw([blk_geom[i] for i in small], np.array(small) + 1, (W, Hh))
    blk_ids = np.where(redraw > 0, redraw, blk_ids)
    zclip = [g.intersection(county_m.buffer(1000)) for g in zgeo]
    zip_ids = draw(zclip, np.arange(1, len(zgeo) + 1), (W, Hh))
    rgba = np.zeros((Hh, W, 4), dtype=np.uint8)
    rgba[..., 0] = blk_ids & 255
    rgba[..., 1] = (blk_ids >> 8) & 255
    rgba[..., 2] = zip_ids & 255
    rgba[..., 3] = np.where(blk_ids > 0, 255, 0)
    Image.fromarray(rgba, "RGBA").save(OUT / "areas_id.png", optimize=True)
    # Block group label points and land area.
    bg_centroids = []
    for g in bg_ids:
        pts = [geom.representative_point() for gg, geom in zip(blocks_order, blk_geom) if gg[:12] == g]
        bg_centroids.append([round(float(np.mean([p.x for p in pts])), 1), round(float(np.mean([p.y for p in pts])), 1)])
    out = {
        "raster": {"x0": x0, "z0": z0, "cell": CELL, "width": W, "height": Hh},
        "metrics": METRICS,
        "block": {"geoid": blocks_order, "bg": block_bg.tolist(), **bk},
        "bg": {**bgm, "center": bg_centroids, "land_km2": [round(v, 3) for v in land_km2], "leave_time": leave, "mode": mode,
               "leave_bins": ["00:00-04:59", "05:00-05:29", "05:30-05:59", "06:00-06:29", "06:30-06:59", "07:00-07:29", "07:30-07:59",
                              "08:00-08:29", "08:30-08:59", "09:00-09:59", "10:00-10:59", "11:00-11:59", "12:00-15:59", "16:00-23:59"]},
        "zip": zm,
    }
    save_json(OUT / "areas.json", out)
    print("block groups", len(bg_ids), "blocks", len(blocks_order), "zips", zids, "raster", W, Hh, "metrics", len(METRICS))


if __name__ == "__main__":
    main()

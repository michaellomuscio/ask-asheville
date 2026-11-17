"""Census API pulls for Buncombe County (cached; the API key never touches disk).

2020 Decennial (block level, the finest public geography):
  PL 94-171  P1 total population, P3 adults, P5 group quarters, H1 housing units/occupancy
  DHC        H9 household size, H10 tenure, P12 sex by age
ACS 2020-2024 5-year (block group, or tract where a table is only published there):
  core   B01001 sex by age, B03002 race and ethnicity, B08303 travel time to work, B11005 households
         with children, B14002 school enrollment, B15003 education, B19001 and B19013 household
         income, B25003 tenure, B25064 rent, B25077 home value
  extra  B25024 units in structure, B25010 average household size by tenure, B08301 means of
         transportation to work, B08302 time leaving home, B25044 vehicles available, B19301 per
         capita income, B01002 median age, C17002 ratio of income to poverty, B25004 vacancy
         status, B25035 median year built, B25001 housing units

Key: $CENSUS_API_KEY (free from api.census.gov; the API now refuses requests without one).
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

import pandas as pd
import requests

from common import CACHE, STATE_FIPS, COUNTY_FIPS

RAW = CACHE / "census"
RAW.mkdir(parents=True, exist_ok=True)
def _key():
    return os.environ.get("CENSUS_API_KEY") or None


def get(path, params, retries=5):
    ident = json.dumps({"path": path, "params": params}, sort_keys=True)
    f = RAW / (hashlib.sha1(ident.encode()).hexdigest()[:20] + ".json")
    if f.exists():
        return json.loads(f.read_text())["rows"]
    q = dict(params)
    k = _key()
    if k:
        q["key"] = k
    last = None
    for i in range(retries):
        try:
            r = requests.get(f"https://api.census.gov/data/{path}", params=q, timeout=180, allow_redirects=False)
            last = r.status_code
            if r.status_code == 200:
                rows = r.json()
                f.write_text(json.dumps({"request": json.loads(ident), "rows": rows}))
                return rows
            if r.status_code in (204, 404):
                return None
            if r.status_code == 400:
                raise RuntimeError(f"400 {path}: {r.text[:300]}")
        except requests.RequestException:
            pass
        time.sleep(2 + 3 * i)
    raise RuntimeError(f"Census API failed {path} status={last}")


def frame(path, params):
    rows = get(path, params)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows[1:], columns=rows[0])
    for c in df.columns:
        if c not in ("state", "county", "tract", "block group", "block", "NAME"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
            df.loc[df[c] < -100000, c] = float("nan")  # jam values (-666666666 etc.)
    return df


def vlist(table, n, start=1, suffix="E"):
    return [f"{table}_{i:03d}{suffix}" for i in range(start, n + 1)]


def blocks():
    geo = {"for": "block:*", "in": f"state:{STATE_FIPS} county:{COUNTY_FIPS} tract:*"}
    pl = frame("2020/dec/pl", {"get": "P1_001N,P3_001N,P5_001N,P5_003N,P5_005N,P5_008N,H1_001N,H1_002N,H1_003N", **geo})
    h = frame("2020/dec/dhc", {"get": ",".join(vlist("H9", 8, suffix="N") + ["H10_001N", "H10_002N"]), **geo})
    age = frame("2020/dec/dhc", {"get": ",".join(vlist("P12", 49, suffix="N")), **geo})
    keys = ["state", "county", "tract", "block"]
    df = pl.merge(h, on=keys).merge(age, on=keys)
    df["geoid"] = df.state + df.county + df.tract + df.block
    out = pd.DataFrame({"geoid": df.geoid})
    out["pop"] = df.P1_001N
    out["adults"] = df.P3_001N
    out["gq"] = df.P5_001N
    out["gq_prison"] = df.P5_003N
    out["gq_nursing"] = df.P5_005N
    out["gq_college"] = df.P5_008N
    out["units"] = df.H1_001N
    out["occupied"] = df.H1_002N
    out["vacant"] = df.H1_003N
    out["owner"] = df.H10_002N
    out["renter"] = df.H10_001N - df.H10_002N
    sizes = [1, 2, 3, 4, 5, 6, 7]
    out["hh_persons"] = sum(df[f"H9_{i + 1:03d}N"] * s for i, s in enumerate(sizes))  # 7+ counted as 7
    m = lambda a, b: df[[f"P12_{i:03d}N" for i in range(a, b + 1)]].sum(axis=1)
    out["age_u5"] = m(3, 3) + m(27, 27)
    out["age_5_17"] = m(4, 6) + m(28, 30)
    out["age_65p"] = m(20, 25) + m(44, 49)
    out.to_parquet(RAW / "blocks_2020.parquet", index=False)
    print("blocks", len(out), "pop", int(out["pop"].sum()), "units", int(out.units.sum()))
    return out


ACS = "2024/acs/acs5"
BG_TABLES = {
    "units_struct": vlist("B25024", 11),
    "hhsize": vlist("B25010", 3),
    "mode": ["B08301_001E", "B08301_002E", "B08301_003E", "B08301_004E", "B08301_010E", "B08301_016E", "B08301_017E",
             "B08301_018E", "B08301_019E", "B08301_020E", "B08301_021E"],
    "leave": vlist("B08302", 15),
    "vehicles": ["B25044_001E", "B25044_003E", "B25044_010E"],
    "misc": ["B19301_001E", "B01002_001E", "B25001_001E", "B25035_001E", "B25004_001E", "B25004_006E"] + vlist("C17002", 8),
}


def acs_bg():
    frames = []
    for name, vs in BG_TABLES.items():
        df = frame(ACS, {"get": ",".join(vs), "for": "block group:*", "in": f"state:{STATE_FIPS} county:{COUNTY_FIPS} tract:*"})
        if df.empty or df[vs].isna().all().all():
            print("  table", name, "missing at block group; using tract")
        frames.append(df)
    keys = ["state", "county", "tract", "block group"]
    out = frames[0]
    for f in frames[1:]:
        out = out.merge(f, on=keys, how="outer")
    out["geoid"] = out.state + out.county + out.tract + out["block group"]
    out.to_parquet(RAW / "acs_bg_extra.parquet", index=False)
    # Tract-level backups for tables that are sparse at block group (departure time, mode).
    tr = None
    for name in ("leave", "mode", "hhsize"):
        vs = BG_TABLES[name]
        df = frame(ACS, {"get": ",".join(vs), "for": "tract:*", "in": f"state:{STATE_FIPS} county:{COUNTY_FIPS}"})
        tr = df if tr is None else tr.merge(df, on=["state", "county", "tract"])
    tr["tract_geoid"] = tr.state + tr.county + tr.tract
    tr.to_parquet(RAW / "acs_tract_extra.parquet", index=False)
    # County totals for reference/calibration.
    co = frame(ACS, {"get": ",".join(BG_TABLES["leave"] + BG_TABLES["mode"] + ["B25044_001E", "B25010_001E"]),
                     "for": f"county:{COUNTY_FIPS}", "in": f"state:{STATE_FIPS}"})
    co.to_parquet(RAW / "acs_county_extra.parquet", index=False)
    print("acs bg", out.shape, "tract", tr.shape)


CORE_TABLES = {
    "age": vlist("B01001", 49),
    "school": vlist("B14002", 49),
    "education": vlist("B15003", 25),
    "income": vlist("B19001", 17) + ["B19013_001E"],
    "misc": vlist("B08303", 13) + ["B03002_001E", "B03002_003E", "B03002_004E", "B03002_012E", "B11005_001E", "B11005_002E"]
            + vlist("B25003", 3) + ["B25064_001E", "B25077_001E"],
}


def acs_core():
    """The main block-group tables (age, income, education, tenure, rent, home value, commute time)."""
    keys = ["state", "county", "tract", "block group"]
    out = None
    for name, vs in CORE_TABLES.items():
        df = frame(ACS, {"get": ",".join(vs), "for": "block group:*", "in": f"state:{STATE_FIPS} county:{COUNTY_FIPS} tract:*"})
        out = df if out is None else out.merge(df, on=keys, how="outer")
    out["geoid"] = out.state + out.county + out.tract + out["block group"]
    out.to_parquet(RAW / "acs_bg_core.parquet", index=False)
    print("acs core", out.shape)


if __name__ == "__main__":
    import sys
    which = set(sys.argv[1:]) or {"blocks", "acs", "core"}
    if "blocks" in which:
        blocks()
    if "acs" in which:
        acs_bg()
    if "core" in which:
        acs_core()

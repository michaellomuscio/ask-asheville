"""Town-level facts for the student version: docs/data/places.json.

Two things the block-group layers can't answer exactly:

1. Which town is a Census block in? The 2020 Census Block Assignment File (INCPLACE_CDP) maps every
   block to its incorporated place or census-designated place, so a town's 2020 population is the sum
   of its blocks and matches the official count.
2. What are a town's medians? Medians can't be added up from block groups, so the ACS 2020-2024
   5-year values for each place, Buncombe County, North Carolina and the United States are read from
   the Census Bureau's public table-based summary files (one pipe-delimited file per table; no API
   key). Only the rows needed are kept while each file streams.

Formulas match build_areas.py so a town's number and its block groups' numbers mean the same thing.

    python3 pipeline/build_places.py        # downloads about 1 GB on the first run, then cached
"""
from __future__ import annotations

import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / "cache" / "places"
OUT = ROOT.parent / "docs" / "data"
CACHE.mkdir(parents=True, exist_ok=True)

BAF = "https://www2.census.gov/geo/docs/maps-data/data/baf2020/BlockAssign_ST37_NC.zip"
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_gaz_place_37.txt"
SF = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-{t}.dat"
TABLES = ["b01001", "b01002", "b03002", "b08301", "b08302", "b08303", "b11005", "b15003", "c17002", "b19001", "b19013",
          "b19301", "b25001", "b25003", "b25004", "b25010", "b25024", "b25035", "b25044", "b25064", "b25077"]
COUNTY = "37021"
WIDER = {"0500000US37021": "county", "0400000US37": "state", "0100000US": "us"}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as r:
        return r.read()


def block_places() -> dict[str, str]:
    f = CACHE / "baf_buncombe.json"
    if f.exists():
        return json.loads(f.read_text())
    z = zipfile.ZipFile(io.BytesIO(fetch(BAF)))
    out = {}
    with z.open("BlockAssign_ST37_NC_INCPLACE_CDP.txt") as fh:
        next(fh)
        for line in fh:
            b, p = line.decode().strip().split("|")
            if b.startswith(COUNTY) and p:
                out[b] = p
    f.write_text(json.dumps(out))
    return out


def gazetteer() -> dict[str, dict]:
    f = CACHE / "gaz_place_37.txt"
    if not f.exists():
        f.write_bytes(fetch(GAZ))
    out = {}
    lines = f.read_text(encoding="latin-1").splitlines()
    head = [h.strip() for h in lines[0].split("\t")]
    for line in lines[1:]:
        row = dict(zip(head, [c.strip() for c in line.split("\t")]))
        out[row["GEOID"][2:]] = {"name": row["NAME"], "land_sqmi": float(row["ALAND_SQMI"])}
    return out


def table_rows(table: str, geoids: set[str]) -> dict[str, dict[str, float]]:
    """{geoid: {column: value}} for the wanted geographies, streamed from the summary file."""
    f = CACHE / f"{table}.json"
    if f.exists():
        got = json.loads(f.read_text())
        if geoids <= set(got):
            return got
    out = {}
    with urllib.request.urlopen(SF.format(t=table), timeout=600) as r:
        head = r.readline().decode().strip().split("|")
        for raw in r:
            gid = raw[: raw.index(b"|")].decode()
            if gid in geoids:
                vals = raw.decode().strip().split("|")
                row = {}
                for h, v in zip(head[1:], vals[1:]):
                    try:
                        x = float(v)
                    except ValueError:
                        continue
                    row[h] = None if x < -100000 else x  # jam values (-666666666 and friends)
                out[gid] = row
    missing = geoids - set(out)
    if missing:
        print(f"  {table}: no rows for {sorted(missing)[:4]}", file=sys.stderr)
    f.write_text(json.dumps(out))
    print(f"  {table}: {len(out)} rows")
    return out


def div(a, b):
    return None if a is None or b in (None, 0) else a / b


def measures(t: dict[str, dict[str, float]], land_sqmi: float | None) -> tuple[dict, dict]:
    """The same measures as the block-group layers, plus margins of error for the direct estimates."""
    def e(table, n):
        return (t.get(table) or {}).get(f"{table.upper()}_E{n:03d}")

    def m(table, n):
        return (t.get(table) or {}).get(f"{table.upper()}_M{n:03d}")

    def s(table, nums):
        vals = [e(table, n) for n in nums]
        return None if any(v is None for v in vals) else sum(vals)

    pop = e("b01001", 1)
    out = {
        "population": pop,
        "density": div(pop, land_sqmi) if land_sqmi else None,
        "median_age": e("b01002", 1),
        "pct_under_18": div(s("b01001", [3, 4, 5, 6, 27, 28, 29, 30]), pop),
        "pct_65_plus": div(s("b01001", list(range(20, 26)) + list(range(44, 50))), pop),
        "pct_hispanic": div(e("b03002", 12), e("b03002", 1)),
        "pct_black": div(e("b03002", 4), e("b03002", 1)),
        "median_income": e("b19013", 1),
        "per_capita_income": e("b19301", 1),
        "pct_hh_100k": div(s("b19001", [14, 15, 16, 17]), e("b19001", 1)),
        "pct_hh_under_35k": div(s("b19001", [2, 3, 4, 5, 6, 7]), e("b19001", 1)),
        "pct_poverty": div(s("c17002", [2, 3]), e("c17002", 1)),
        "pct_bachelors": div(s("b15003", [22, 23, 24, 25]), e("b15003", 1)),
        "pct_graduate": div(s("b15003", [23, 24, 25]), e("b15003", 1)),
        "avg_household_size": e("b25010", 1),
        "pct_hh_kids": div(e("b11005", 2), e("b11005", 1)),
        "pct_renter": div(e("b25003", 3), e("b25003", 1)),
        "median_home_value": e("b25077", 1),
        "median_rent": e("b25064", 1),
        "median_year_built": e("b25035", 1) if (e("b25035", 1) or 0) > 1800 else None,
        "pct_seasonal": div(e("b25004", 6), e("b25001", 1)),
        "pct_single_family": div(e("b25024", 2), e("b25024", 1)),
        "pct_apartments": div(s("b25024", [6, 7, 8, 9]), e("b25024", 1)),
        "pct_mobile": div(e("b25024", 10), e("b25024", 1)),
        "pct_commute_30": div(s("b08303", [8, 9, 10, 11, 12, 13]), e("b08303", 1)),
        "pct_wfh": div(e("b08301", 21), e("b08301", 1)),
        "pct_drive_alone": div(e("b08301", 3), e("b08301", 1)),
        "pct_leave_before_7": div(s("b08302", [2, 3, 4, 5, 6]), e("b08302", 1)),
        "pct_no_vehicle": div(s("b25044", [3, 10]), e("b25044", 1)),
    }
    moe = {
        "population": m("b01001", 1), "median_age": m("b01002", 1), "median_income": m("b19013", 1),
        "per_capita_income": m("b19301", 1), "median_home_value": m("b25077", 1), "median_rent": m("b25064", 1),
        "avg_household_size": m("b25010", 1),
    }
    rnd = lambda v: None if v is None else (round(v, 4) if abs(v) < 20 else round(v, 1))
    return {k: rnd(v) for k, v in out.items()}, {k: rnd(v) for k, v in moe.items() if v is not None and v > 0}


def main():
    areas = json.loads((OUT / "areas.json").read_text())
    geoids = areas["block"]["geoid"]
    pops = areas["block"]["pop"]
    baf = block_places()
    gaz = gazetteer()
    codes = sorted({p for p in baf.values() if p != "99999"})
    # 2020 population of each place inside the county, from its blocks.
    pop2020 = {c: 0 for c in codes}
    nblocks = {c: 0 for c in codes}
    for g, p in zip(geoids, pops):
        c = baf.get(g)
        if c in pop2020:
            pop2020[c] += p
            nblocks[c] += 1
    codes = [c for c in codes if pop2020[c] >= 200]
    wanted = {f"1600000US37{c}" for c in codes} | set(WIDER)
    tables = {t: table_rows(t, wanted) for t in TABLES}
    rows = lambda gid: {t: tables[t].get(gid) for t in TABLES}

    places = []
    for c in codes:
        g = gaz.get(c, {})
        full = g.get("name", c)
        kind = "city" if full.endswith(" city") else "town" if full.endswith(" town") else "village" if full.endswith(" village") else "community"
        name = full.rsplit(" ", 1)[0] if kind != "community" else full.replace(" CDP", "")
        vals, moe = measures(rows(f"1600000US37{c}"), g.get("land_sqmi"))
        places.append({"id": "37" + c, "name": name, "kind": kind, "pop2020": pop2020[c], "blocks": nblocks[c],
                       "land_sqmi": g.get("land_sqmi"), "m": vals, "moe": moe})
    places.sort(key=lambda p: -p["pop2020"])
    index = {p["id"][2:]: i for i, p in enumerate(places)}
    block_place = [index.get(baf.get(g, ""), -1) for g in geoids]

    wider = {}
    for gid, key in WIDER.items():
        vals, moe = measures(rows(gid), None)
        wider[key] = {"m": vals, "moe": moe}
    # County density from the block groups' land area.
    land = sum(areas["bg"]["land_km2"]) / 2.58999
    wider["county"]["land_sqmi"] = round(land, 1)
    wider["county"]["m"]["density"] = round(wider["county"]["m"]["population"] / land, 1)
    wider["county"]["pop2020"] = sum(pops)
    wider["county"]["name"] = "Buncombe County"
    wider["state"]["name"] = "North Carolina"
    wider["us"]["name"] = "United States"

    out = {
        "source": "Town membership: 2020 Census Block Assignment File. Town, county, state and national values: "
                  "American Community Survey 2020-2024 5-year table-based summary file (U.S. Census Bureau).",
        "places": places, **wider, "block_place": block_place,
    }
    (OUT / "places.json").write_text(json.dumps(out, separators=(",", ":")))
    for p in places:
        print(f"{p['name']:<18}{p['kind']:<10} 2020 pop {p['pop2020']:>7,}  ACS pop {p['m']['population'] or 0:>9,.0f}  median income {p['m']['median_income']}")
    for k in ("county", "state", "us"):
        print(f"{wider[k]['name']:<28} pop {wider[k]['m']['population']:>12,.0f}  median income {wider[k]['m']['median_income']}")
    print("blocks inside a town:", sum(1 for b in block_place if b >= 0), "of", len(block_place))


if __name__ == "__main__":
    main()

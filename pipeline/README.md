# Data pipeline

Turns public data into the files the site loads (`../docs/data/`). Python 3.12 in a uv venv.

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

Downloads land in `cache/` and intermediate products in `work/` (both gitignored). You do not need
any of this to run or change the site: the built data is committed in `docs/data/`. The pipeline is
here so the numbers can be traced and rebuilt.

## Order

| Step | Script | What it does |
|---|---|---|
| 1 | (shell) | Download the Geofabrik North Carolina PBF to `cache/osm/`, then `osmium extract -b <terrain bbox> -s complete_ways -o cache/osm/buncombe.osm.pbf` |
| 2 | (shell) | LODES 8 NC files to `cache/lodes/`: `od/nc_od_main_JT01_2023`, `od/nc_od_aux_JT01_2023`, `wac/nc_wac_S000_JT00_2023`, `nc_xwalk` |
| 3 | (shell) | TIGER 2020 PL files for Buncombe (blocks, block groups), NC counties, and the 2020 ZCTA cartographic boundaries to `cache/tiger/` |
| 4 | `fetch_county_gis.py` | Buncombe County parcels (class codes only), address points, school attendance districts |
| 5 | `fetch_census.py` | 2020 Census block counts and the ACS block-group tables (needs a free `CENSUS_API_KEY` in the environment; it is never written to disk) |
| 6 | `fetch_terrain.py` | Terrain tiles -> 30 m grid; NLCD land cover |
| 7 | `osm_extract.py` | One pass over the OSM extract: roads, controls, buildings, water, rail, POIs, places |
| 8 | `build_roads.py` | Routable graph with lanes, speeds, controls, gateways; largest strongly connected part |
| 9 | `build_buildings.py` | Building kinds, homes, households, residents, jobs (see the docstring for the method) |
| 10 | `build_areas.py` | Block group and block measures; the area id raster |
| 11 | `build_demand.py` | LODES commute flows with outside corridors; school assignments |
| 12 | `ors_server.py start` | Local openrouteservice 9.10 on the roads-only extract (port 8093) |
| 13 | `calibrate_ors.py` | Snap buildings to roads; fit free-flow speeds to ORS; ORS isochrones around downtown (`calibrate_ors.py isochrones` refreshes only those) |
| 14 | `build_pois.py` | Emergency services, schools, venues, hotels, places (merges `research/buncombe_facts.json`) |
| 15 | `build_facts.py` | Curated facts for the UI (traffic counts, EMS goals, tourism) |
| 16 | `pack.py` | Write `../docs/data/*.bin.gz`, `county.json`, `manifest.json` |
| 17 | `trim_places.py` | Leave breweries off the place list; refresh the manifest |
| 18 | `build_places.py` | Which town each Census block is in, and official values for towns, the county, the state and the nation (`places.json`) |

The typical-day congestion files (`docs/data/typical_*.bin.gz`) come from the simulation itself:
`node scripts/headless.js` (see the repository README).

## Inputs you supply

Two inputs have no fetch script here and go into `cache/` by hand:

- `cache/schools/ccd2022_buncombe.json` and `cache/schools/pss2122.json`: the NCES Common Core of Data
  (public and charter schools, 2022-23) and Private School Survey (2021-22) records for the area.
  `build_demand.py` shows the fields it reads.
- `cache/ors/ors-9.10.0.jar`: the openrouteservice 9.10 release jar, used only to calibrate road speeds.

## Notes

- Census 2020 block counts carry differential-privacy noise (some blocks have people but no homes);
  `build_buildings.py` reassigns those residents within their block group so county totals stay exact.
- ORS assumes 15 km/h on untagged residential streets; the calibration fits per-class factors so
  drive times agree with ORS while simulated cars still drive at posted speeds.
- `build_roads.py` joins boundary nodes to a virtual "outside" node before the connectivity test so
  one-way interstate carriageways crossing the county line survive.

## Town-level values

`build_places.py` needs no API key: it reads the Census Bureau's public Block Assignment File and the
ACS 2020-2024 table-based summary files (about 1 GB streamed on the first run; only the rows it needs
are cached in `cache/places/`). Its formulas match `build_areas.py`, so a town's number and its block
groups' numbers mean the same thing.

## What has and has not been re-run

`build_areas.py` and `build_places.py` were re-run against cached inputs and reproduce the published
files. The fetch and build steps before them were last run when the data was built (October 2026);
`fetch_census.py core` was written afterward to replace a cached table and has not been run against
the live API.

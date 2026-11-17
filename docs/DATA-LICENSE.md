# Data license and sources

The files in `data/` are built from the public sources below.

## OpenStreetMap (Open Database License)

Roads, buildings, water, rail and many places come from OpenStreetMap (Geofabrik North Carolina
extract, 2026-10-05). © OpenStreetMap contributors. That data, and the files derived from it
(`roads.bin.gz`, `buildings.bin.gz`, `water.bin.gz`, and the OpenStreetMap places in `pois.json`),
is available under the [Open Database License 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
You may copy, share and adapt it if you credit OpenStreetMap contributors and keep any database you
build from it under the same license. See https://www.openstreetmap.org/copyright.

## Public and open data

| Source | Used for | Terms |
|---|---|---|
| U.S. Census Bureau: 2020 Census, ACS 2020-2024 5-year, LEHD LODES 8 | people, homes, neighborhood characteristics, jobs and commutes | U.S. government work, public domain |
| U.S. Census Bureau: 2020 Block Assignment Files and the ACS 2020-2024 5-year summary file | which town each Census block is in; values for towns, the county, the state and the nation (`places.json`) | U.S. government work, public domain |
| NCES Common Core of Data and Private School Survey | schools and enrollments | U.S. government work, public domain |
| USGS 3DEP elevation (via AWS Terrain Tiles) and NLCD 2021 land cover | terrain and land cover | public domain (Terrain Tiles also credit their compiled sources) |
| Buncombe County GIS open data | parcel land-use class codes (no owner or value fields), E911 address points, school attendance districts | county public records |
| NCDOT traffic counts | calibration of simulated traffic | public records |
| openrouteservice 9.10 (run locally) | reference drive times used to calibrate road speeds | results only; no openrouteservice code or data is included |
| Local agency pages and news reports (`facts.json`) | emergency services, venues, visitor counts and other facts | compiled from public sources |

People and jobs in individual buildings are modeled from Census block and LODES totals to drive the
simulated traffic. They are estimates, not records, and the map reports people only for Census blocks
and larger areas.

## Software and fonts served with the page

- three.js 0.186.1 (`vendor/three/`), MIT License, © three.js authors.
- Overpass and Overpass Mono (`vendor/fonts/`), SIL Open Font License 1.1.

They are served from this site so the page contacts no other host.

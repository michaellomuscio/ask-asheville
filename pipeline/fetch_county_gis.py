"""Download Buncombe County open GIS layers (public ArcGIS REST services).

- Parcels: polygon + property class code only. Owner names, values and sale
  data are deliberately NOT requested; the simulation only needs land use.
- Address points: civic address + ZIP + location (powers address search and
  counts addresses per building).
- School attendance districts, if the service exposes them.

Writes newline-delimited GeoJSON under cache/county/. Resumable: finished pages
are skipped on a re-run.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import requests

from common import CACHE

BASE = "https://gis.buncombecounty.org/arcgis/rest/services"
OUTDIR = CACHE / "county"
OUTDIR.mkdir(parents=True, exist_ok=True)
S = requests.Session()


def get(url, params, tries=6):
    for i in range(tries):
        try:
            r = S.post(url, data=params, timeout=180)
            if r.status_code == 200:
                d = r.json()
                if "error" in d:
                    raise RuntimeError(d["error"])
                return d
        except Exception as e:  # noqa: BLE001 - retry anything transient
            print("  retry", i + 1, type(e).__name__, str(e)[:120], file=sys.stderr)
        time.sleep(2 + 3 * i)
    raise RuntimeError(f"failed: {url}")


def object_ids(layer_url, where="1=1"):
    d = get(f"{layer_url}/query", {"where": where, "returnIdsOnly": "true", "f": "json"})
    return sorted(d["objectIds"])


def dump_layer(name, layer_url, fields, page=1000):
    out = OUTDIR / f"{name}.ndjson"
    pages_dir = OUTDIR / f"{name}_pages"
    pages_dir.mkdir(exist_ok=True)
    ids = object_ids(layer_url)
    print(name, len(ids), "features")
    chunks = [ids[i:i + page] for i in range(0, len(ids), page)]
    for k, chunk in enumerate(chunks):
        f = pages_dir / f"{k:04d}.json"
        if f.exists():
            continue
        d = get(f"{layer_url}/query", {
            "objectIds": ",".join(map(str, chunk)),
            "outFields": ",".join(fields),
            "returnGeometry": "true",
            "outSR": "4326",
            "geometryPrecision": "7",
            "f": "geojson",
        })
        f.write_text(json.dumps(d["features"]))
        if k % 10 == 0:
            print(f"  {name} page {k + 1}/{len(chunks)}")
    n = 0
    with out.open("w") as fo:
        for f in sorted(pages_dir.glob("*.json")):
            for feat in json.loads(f.read_text()):
                fo.write(json.dumps(feat, separators=(",", ":")) + "\n")
                n += 1
    print(name, "wrote", n)


if __name__ == "__main__":
    which = set(sys.argv[1:]) or {"parcels", "addresses", "schools"}
    if "parcels" in which:
        dump_layer("parcels", f"{BASE}/opendata/MapServer/1",
                   ["objectid", "Class", "LandUse", "Improved", "Exempt", "Acreage", "CondoUnit", "CondoBuilding", "NmpType"])
    if "addresses" in which:
        dump_layer("addresses", f"{BASE}/opendata/MapServer/2", ["ObjectId", "FullCivicAddress", "ZipCode"], page=2000)
    if "schools" in which:
        layer = f"{BASE}/schools_districts/MapServer"
        meta = get(layer, {"f": "json"})
        for lyr in meta.get("layers", []):
            info = get(f"{layer}/{lyr['id']}", {"f": "json"})
            fields = [f["name"] for f in info.get("fields", []) if f["type"] != "esriFieldTypeGeometry"]
            print("school layer", lyr["id"], lyr["name"], info.get("geometryType"), fields[:12])
            try:
                dump_layer(f"schools_layer{lyr['id']}", f"{layer}/{lyr['id']}", fields or ["*"], page=500)
            except Exception as e:  # noqa: BLE001
                print("  skip", lyr["name"], e)

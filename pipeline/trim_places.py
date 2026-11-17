"""Last step for the published data: leave breweries off the place list (this site is for students)
and refresh the file sizes in the manifest.

    python3 pipeline/trim_places.py
"""
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"

pois = json.loads((DATA / "pois.json").read_text())
kept = [p for p in pois if p["kind"] != "brewery"]
for p in kept:
    if p.get("notes"):
        p["notes"] = p["notes"].replace("Shops, restaurants, breweries, galleries.", "Shops, restaurants and galleries.").replace(
            "Studios and breweries along the French Broad.", "Artists' studios along the French Broad River.")
(DATA / "pois.json").write_text(json.dumps(kept, separators=(",", ":")))
print(f"pois.json: {len(pois)} -> {len(kept)} places")

man = json.loads((DATA / "manifest.json").read_text())
for s in man["sources"]:
    if s["name"].startswith("NCES"):
        s["name"] = "NCES Common Core of Data 2022-23 and Private School Survey"
man["files"] = {p.name: p.stat().st_size for p in sorted(DATA.iterdir()) if p.is_file() and p.name != "manifest.json"}
(DATA / "manifest.json").write_text(json.dumps(man, indent=1))
print("manifest.json refreshed")

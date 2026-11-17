"""Points of interest: emergency services, schools, venues, attractions, hotels, places.

Emergency stations come from OpenStreetMap, merged with a verified list
(research/buncombe_facts.json) whose street addresses are geocoded against the
county's own E911 address points. Venues and attractions are a curated list with OSM
locations. Every POI is snapped to a road node it can be driven to.

Writes data/pois.json.
"""
from __future__ import annotations

import gzip
import json
import math
import pickle
import re
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree
from shapely.geometry import Point
from shapely.ops import transform
from shapely.prepared import prep

from common import OUT, ROOT, WORK, county_shape, project, save_json, unproject

RESEARCH = ROOT / "research" / "buncombe_facts.json"


def norm_addr(s):
    s = (s or "").upper()
    s = s.split(",")[0]
    s = re.sub(r"[.#]", "", s)
    rep = {" ROAD": " RD", " STREET": " ST", " AVENUE": " AVE", " DRIVE": " DR", " HIGHWAY": " HWY", " BOULEVARD": " BLVD",
           " LANE": " LN", " PLACE": " PL", " PARKWAY": " PKWY", " CIRCLE": " CIR", " COURT": " CT", " TERRACE": " TER",
           " NORTH": " N", " SOUTH": " S", " EAST": " E", " WEST": " W", " EXTENSION": " EXT", " TRAIL": " TRL", " PLAZA": " PLZ"}
    for a, b in rep.items():
        s = s.replace(a, b)
    s = re.sub(r"\b(SUITE|STE|UNIT)\b.*$", "", s)
    return " ".join(s.split())


class Geocoder:
    def __init__(self):
        with gzip.open(WORK / "addresses.json.gz", "rt") as f:
            d = json.load(f)
        self.index = {}
        for x, z, lab in zip(d["x"], d["z"], d["label"]):
            a = norm_addr(lab.split("|")[0])
            self.index.setdefault(a, (x, z))

    def lookup(self, address):
        a = norm_addr(address)
        if a in self.index:
            return self.index[a]
        # Tolerate a missing street-type suffix.
        base = re.sub(r" (RD|ST|AVE|DR|HWY|BLVD|LN|PL|PKWY|CIR|CT|TER|WAY|TRL)$", "", a)
        for k in (base + " RD", base + " ST", base + " AVE", base + " DR", base + " HWY", base):
            if k in self.index:
                return self.index[k]
        return None


VENUES = [
    # id, name, kind, capacity, OSM name hint (None = use the coordinates), lat/lon, notes
    ("mccormick", "HomeTrust Park (McCormick Field)", "stadium", 4000, None, (35.587119, -82.550075),
     "Home of the Asheville Tourists (High-A, Houston Astros). Renamed from McCormick Field in April 2026 after a renovation."),
    ("orange_peel", "The Orange Peel", "music", 1050, None, (35.591422, -82.551129), "Music venue on Biltmore Avenue; most shows doors 7 pm, show 8 pm."),
    ("hellbender", "Hellbender by the Orange Peel", "music", 6000, None, (35.5745, -82.5250),
     "Outdoor amphitheater near Biltmore Village, opened August 2026; shows end by 10 pm (location approximate)."),
    ("hcca", "Harrah's Cherokee Center Asheville", "arena", 7200, None, (35.597478, -82.555293),
     "ExploreAsheville.com Arena (up to ~7,200) and Thomas Wolfe Auditorium (2,431)."),
    ("biltmore", "Biltmore Estate (main gate)", "attraction", 10000, None, (35.566416, -82.545328),
     "Visitors enter at Biltmore Village and drive about 3 miles to the house. Candlelight Christmas Evenings Nov 3, 2026 - Jan 9, 2027."),
    ("arboretum", "The North Carolina Arboretum", "attraction", 3000, None, (35.501732, -82.598905),
     "Gardens next to the Blue Ridge Parkway; Winter Lights Nov 13, 2026 - Jan 3, 2027, 6-10 pm with timed vehicle entry."),
    ("grove_park", "The Omni Grove Park Inn", "attraction", 1500, None, (35.620638, -82.542471), "Historic resort on Sunset Mountain (513 rooms)."),
    ("downtown", "Downtown Asheville (Pack Square)", "district", 8000, None, (35.59510, -82.55100), "Shops, restaurants, breweries, galleries."),
    ("rad", "River Arts District", "district", 3000, None, (35.58640, -82.56980), "Studios and breweries along the French Broad."),
    ("biltmore_village", "Biltmore Village", "district", 2500, None, (35.56760, -82.54480), "Shops at the Biltmore Estate gate."),
    ("asheville_mall", "Asheville Mall", "shopping", 6000, None, (35.581788, -82.526365), "Largest mall in Western North Carolina, on Tunnel Road."),
    ("outlets", "Tanger Outlets Asheville", "shopping", 3000, None, (35.529177, -82.604341), "Open-air outlet center on Brevard Road (~70 stores)."),
    ("biltmore_park", "Biltmore Park Town Square", "shopping", 3000, None, (35.48810, -82.55460), "Shops, offices and a cinema in South Asheville."),
    ("folk_art", "Folk Art Center (Blue Ridge Parkway)", "parkway", 1500, None, (35.60250, -82.48550), "Parkway stop at milepost 382."),
    ("craggy", "Craggy Gardens (Blue Ridge Parkway)", "parkway", 1500, None, (35.69930, -82.38040), "High-elevation overlook at milepost 364; heavy leaf-season traffic."),
    ("brp_vc", "Blue Ridge Parkway Visitor Center", "parkway", 1500, None, (35.56480, -82.48650), "Parkway visitor center at milepost 384."),
    ("unca", "UNC Asheville", "campus", 3500, None, (35.61610, -82.56700), "University campus in North Asheville."),
    ("wnc_nature", "WNC Nature Center", "attraction", 1200, None, (35.57950, -82.49540), "Wildlife park in East Asheville."),
    ("avl", "Asheville Regional Airport", "airport", 3000, None, (35.43620, -82.54180), "Just outside the county line in Fletcher."),
]


def main():
    county = county_shape()
    county_m = transform(lambda x, y, z=None: project(x, y), county)
    near_county = prep(county_m.buffer(3000))
    g = np.load(WORK / "graph.npz")
    cls = g["e_cls"]
    access = np.zeros(len(g["node_x"]), dtype=bool)
    for f, t, c in zip(g["e_from"], g["e_to"], cls):
        if c not in (0, 1, 2, 3):
            access[f] = True
            access[t] = True
    cand = np.where(access)[0]
    tree = cKDTree(np.column_stack([g["node_x"][cand], g["node_z"][cand]]))

    def snap(x, z):
        d, k = tree.query([x, z])
        return int(cand[k]), float(d)

    pois = pickle.load(open(WORK / "osm_pois.pkl", "rb"))
    for p in pois:
        x, z = project(p["lon"], p["lat"])
        p["x"], p["z"] = float(x), float(z)
    pois = [p for p in pois if near_county.contains(Point(p["x"], p["z"]))]
    geo = Geocoder()
    out = []

    def add(kind, sub, name, x, z, **extra):
        if not (math.isfinite(x) and math.isfinite(z)):
            print("  skipped (no coordinates):", kind, name)
            return None
        node, d = snap(x, z)
        lon, lat = unproject(x, z)
        rec = {"kind": kind, "sub": sub, "name": name, "x": round(x, 1), "z": round(z, 1), "lat": round(float(lat), 6),
               "lon": round(float(lon), 6), "node": node, "snap_m": round(d, 1)}
        rec.update({k: v for k, v in extra.items() if v not in (None, "")})
        out.append(rec)
        return rec

    def dedupe_near(items, radius):
        kept = []
        for it in items:
            if any(math.hypot(it["x"] - k["x"], it["z"] - k["z"]) < radius and (not it.get("name") or not k.get("name")
                                                                                  or it["name"] == k["name"] or radius > 0) for k in kept):
                # Prefer named records.
                for k in kept:
                    if math.hypot(it["x"] - k["x"], it["z"] - k["z"]) < radius and not k.get("name") and it.get("name"):
                        k.update(it)
                continue
            kept.append(dict(it))
        return kept

    research = json.loads(RESEARCH.read_text()) if RESEARCH.exists() else {}

    # --- Hospitals / emergency departments ---------------------------------------------------------
    hosp = []
    for r in (research.get("hospitals_ed") or {}).get("open_eds_accepting_911", []):
        loc = None
        if r.get("lat") and r.get("lon"):
            loc = project(r["lon"], r["lat"])
        elif r.get("address"):
            loc = geo.lookup(r["address"])
        if loc is None:
            continue
        trauma = r.get("trauma_level") or ""
        trauma = "Level I trauma center" if "Level I " in trauma or trauma.startswith("ACS-verified Level I") else ("" if "not" in trauma else trauma[:60])
        hosp.append({"name": r["name"], "x": float(loc[0]), "z": float(loc[1]), "ed": r.get("ed_type"), "trauma": trauma,
                     "operator": r.get("operator"), "address": r.get("address"), "notes": r.get("notes")})
    for p in pois:
        if p.get("amenity") == "hospital" or p.get("healthcare") == "hospital":
            if p.get("name") and not any(math.hypot(p["x"] - h["x"], p["z"] - h["z"]) < 400 for h in hosp):
                ed = "full hospital ED" if p.get("emergency") == "yes" else ("VA, veterans only" if "Veterans" in p["name"] else None)
                hosp.append({"name": p["name"], "x": p["x"], "z": p["z"], "ed": ed, "operator": p.get("operator")})
    for h in hosp:
        ed_type = str(h.get("ed") or "")
        sub = "ed" if ed_type in ("full hospital ED", "freestanding ED") else "va" if ed_type.startswith("VA") else "hospital"
        add("hospital", sub, h["name"], h["x"], h["z"], ed=h.get("ed"), trauma=h.get("trauma"), operator=h.get("operator"),
            address=h.get("address"), notes=h.get("notes"))

    # --- Fire stations ----------------------------------------------------------------------------------
    fire = []
    for r in (research.get("fire_stations") or {}).get("stations", []):
        loc = None
        if r.get("lat") and r.get("lon"):
            loc = project(r["lon"], r["lat"])
        elif r.get("address"):
            loc = geo.lookup(r["address"])
        if loc is None:
            continue
        nm = f"{r.get('department', '')} {r.get('station', '')}".strip()
        app = r.get("apparatus")
        fire.append({"name": nm, "x": float(loc[0]), "z": float(loc[1]), "address": r.get("address"),
                     "apparatus": ", ".join(app) if isinstance(app, list) else app, "department": r.get("department"),
                     "approx": "approximate" in str(r.get("coord_source", "")).lower()})
    for p in pois:
        if p.get("amenity") == "fire_station":
            if not any(math.hypot(p["x"] - f["x"], p["z"] - f["z"]) < 250 for f in fire):
                fire.append({"name": p.get("name") or "Fire station", "x": p["x"], "z": p["z"], "department": p.get("operator")})
    fire = dedupe_near(fire, 120)
    for f in fire:
        if near_county.contains(Point(f["x"], f["z"])):
            add("fire", "station", f["name"], f["x"], f["z"], address=f.get("address"), apparatus=f.get("apparatus"), department=f.get("department"),
                approx=bool(f.get("approx")) or None)

    # --- EMS -------------------------------------------------------------------------------------------------
    # Buncombe County EMS works mostly as a guest in fire stations. Only EMS 9 (Reynolds) has a confirmed
    # address; the other named bases are placed at the fire station in the area the county names and
    # flagged approximate.
    ems_cfg = [("EMS 9 (East Asheville)", (35.551718, -82.476736), False, "Reynolds VFD, 1 Charles A Lytle Ln"),
               ("EMS 1 (Downtown)", "Asheville Fire Department Station 1", True, None),
               ("EMS 3 (Enka-Candler)", "Enka-Candler", True, None),
               ("EMS 4 (Black Mountain)", "Black Mountain", True, None),
               ("EMS 5 (Skyland)", "Skyland", True, None),
               ("EMS 8 (Weaverville)", "Weaverville", True, None),
               ("EMS 2 (West Asheville)", "Asheville Fire Department Station 6", True, None),
               ("EMS 6 (Leicester)", "Leicester", True, None),
               ("EMS 10 (Fairview)", "Fairview", True, None),
               ("EMS 11 (North Buncombe)", "North Buncombe", True, None)]
    fire_recs = [o for o in out if o["kind"] == "fire"]
    for nm, where, approx, host in ems_cfg:
        if isinstance(where, tuple):
            x, z = project(where[1], where[0])
            add("ems", "station", nm, float(x), float(z), approx=None, host=host)
            continue
        hosts = [f for f in fire_recs if where.lower() in (f.get("name", "") + " " + str(f.get("department", ""))).lower()]
        if not hosts:
            continue
        f = hosts[0]
        add("ems", "station", nm, f["x"], f["z"], approx=True, host=f["name"])
    for p in pois:
        if p.get("emergency") == "ambulance_station" and p.get("name"):
            add("ems", "station", p["name"], p["x"], p["z"])

    # --- Police -------------------------------------------------------------------------------------------------
    pol = []
    for r in (research.get("police") or {}).get("agencies", []):
        if not isinstance(r, dict):
            continue
        loc = None
        if r.get("lat") and r.get("lon"):
            loc = project(r["lon"], r["lat"])
        elif r.get("address"):
            loc = geo.lookup(r["address"])
        if loc is None:
            continue
        nm = r.get("name") or r.get("agency")
        ag = r.get("agency") or ""
        if ag and (nm in ("HQ", "Headquarters") or nm.startswith("HQ") or not any(w in nm for w in ag.split()[:1])):
            nm = f"{ag} - {nm}"
        pol.append({"name": nm, "agency": ag, "x": float(loc[0]), "z": float(loc[1]), "address": r.get("address")})
    for p in pois:
        if p.get("amenity") == "police" and p.get("name"):
            if not any(math.hypot(p["x"] - q["x"], p["z"] - q["z"]) < 200 for q in pol):
                pol.append({"name": p["name"], "agency": p.get("operator"), "x": p["x"], "z": p["z"]})
    pol = dedupe_near(pol, 100)
    for q in pol:
        if near_county.contains(Point(q["x"], q["z"])):
            add("police", "station", q["name"], q["x"], q["z"], agency=q.get("agency"), address=q.get("address"))

    # --- Schools -----------------------------------------------------------------------------------------------------
    schools = json.load(open(WORK / "schools.json"))
    for i, s in enumerate(schools):
        nm = s["name"]
        sub = s["kind"]
        level = "high" if (s["lo"] or 0) >= 9 else "middle" if (s["lo"] or 0) >= 5 and (s["hi"] or 0) <= 8 else "elementary" if (s["hi"] or 0) <= 6 else "k12"
        rec = add("school", sub, nm, s["x"], s["z"], school_index=i, lo=s["lo"], hi=s["hi"], enrollment=s["enrollment"], level=level,
                  district=s.get("district"))
    # Colleges and universities (destinations, not school-trip targets).
    for p in pois:
        if p.get("amenity") in ("university", "college") and p.get("name") and p.get("osm", "").startswith(("w", "r")):
            if any(math.hypot(p["x"] - o["x"], p["z"] - o["z"]) < 300 for o in out if o["kind"] == "college"):
                continue
            add("college", p["amenity"], p["name"], p["x"], p["z"])

    # --- Venues & attractions ----------------------------------------------------------------------------------------
    for vid, nm, kind, cap, hint, ll, note in VENUES:
        x = z = None
        if hint:
            best = None
            for p in pois:
                if p.get("name") and hint.lower() in p["name"].lower():
                    area_pref = 0 if p.get("osm", "").startswith(("w", "r")) else 1
                    key = (area_pref, len(p["name"]))
                    if best is None or key < best[0]:
                        best = (key, p)
            if best:
                x, z = best[1]["x"], best[1]["z"]
        if x is None:
            x, z = project(ll[1], ll[0])
            x, z = float(x), float(z)
        add("venue", kind, nm, x, z, id=vid, capacity=cap, notes=note)

    # Breweries (Asheville is "Beer City USA") as leisure destinations.
    for p in pois:
        if (p.get("craft") == "brewery" or "brew" in (p.get("name") or "").lower()) and p.get("amenity") in ("pub", "bar", "restaurant", None):
            if p.get("name") and not any(o["kind"] == "brewery" and math.hypot(p["x"] - o["x"], p["z"] - o["z"]) < 80 for o in out):
                add("brewery", "brewery", p["name"], p["x"], p["z"])

    # --- Hotels ---------------------------------------------------------------------------------------------------------
    hotels = []
    for p in pois:
        if p.get("tourism") in ("hotel", "motel", "guest_house", "hostel") and p.get("name"):
            rooms = None
            try:
                rooms = int(str(p.get("rooms", "")).split(";")[0])
            except ValueError:
                pass
            if not any(math.hypot(p["x"] - h["x"], p["z"] - h["z"]) < 60 for h in hotels):
                hotels.append({"name": p["name"], "x": p["x"], "z": p["z"], "rooms": rooms, "type": p["tourism"]})
    import pandas as pd
    bld = pd.read_parquet(WORK / "buildings.parquet")
    hb = bld[bld.kind == 6]  # hotel buildings (parcel classes 414/415/418)
    htree = cKDTree(hb[["x", "z"]].to_numpy()) if len(hb) else None
    for h in hotels:
        if h["rooms"] is None and htree is not None:
            idx = htree.query_ball_point([h["x"], h["z"]], 120)
            fa = float((hb.iloc[idx].area * hb.iloc[idx].floors).sum()) if idx else 0
            h["rooms"] = int(max(8, min(600, fa / 45))) if fa > 0 else (12 if h["type"] in ("guest_house", "hostel") else 60)
        add("hotel", h["type"], h["name"], h["x"], h["z"], rooms=h["rooms"])

    # --- Parking for events (decks and big lots) ----------------------------------------------------------------------
    for p in pois:
        if p.get("amenity") == "parking" and (p.get("parking") in ("multi-storey", "underground") or p.get("capacity")):
            try:
                capv = int(str(p.get("capacity", "0")).split(";")[0])
            except ValueError:
                capv = 0
            if p.get("parking") in ("multi-storey", "underground") or capv >= 80:
                add("parking", p.get("parking") or "surface", p.get("name") or "Parking", p["x"], p["z"], capacity=capv or None)

    # --- Place labels -----------------------------------------------------------------------------------------------------
    places = pickle.load(open(WORK / "osm_places.pkl", "rb"))
    for pl in places:
        x, z = project(pl["lon"], pl["lat"])
        if not near_county.contains(Point(float(x), float(z))) or not pl.get("name"):
            continue
        if pl["place"] in ("city", "town", "village", "suburb", "neighbourhood", "hamlet", "quarter", "locality"):
            rank = {"city": 5, "town": 4, "village": 3, "suburb": 3, "quarter": 2, "neighbourhood": 2, "hamlet": 1, "locality": 1}[pl["place"]]
            out.append({"kind": "place", "sub": pl["place"], "name": pl["name"], "x": round(float(x), 1), "z": round(float(z), 1), "rank": rank})

    save_json(OUT / "pois.json", out)
    from collections import Counter
    print(Counter((o["kind"], o.get("sub")) for o in out).most_common(40))


if __name__ == "__main__":
    main()

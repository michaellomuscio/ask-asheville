"""One pass over the Buncombe-area OSM extract.

Writes pickles under work/:
  osm_roads.pkl      drivable highway ways: id, tags, node ids, lon/lat
  osm_controls.pkl   node id -> traffic control (signals, stop, give way, rail crossing)
  osm_buildings.pkl  building footprints (outer + inner rings) with a few tags
  osm_water.pkl      water polygons and river/stream lines
  osm_rail.pkl       railway lines
  osm_pois.pkl       amenities/tourism/leisure/shops etc. (nodes and area centroids)
  osm_places.pkl     place nodes for labels
"""
from __future__ import annotations

import pickle
import sys

import osmium

from common import CACHE, WORK

PBF = CACHE / "osm" / "buncombe.osm.pbf"

ROAD_KEYS = ("highway", "name", "ref", "oneway", "maxspeed", "lanes", "lanes:forward", "lanes:backward",
             "bridge", "tunnel", "junction", "access", "motor_vehicle", "motorcar", "vehicle", "service",
             "layer", "area", "surface", "toll", "destination", "destination:ref", "turn:lanes", "official_name",
             "covered", "barrier")
DRIVABLE = {"motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary",
            "secondary_link", "tertiary", "tertiary_link", "unclassified", "residential", "living_street",
            "road", "service", "track", "busway"}
BLD_KEYS = ("building", "building:levels", "levels", "height", "roof:shape", "roof:levels", "name", "amenity",
            "shop", "tourism", "addr:housenumber", "addr:street", "building:use", "min_height", "building:part")
POI_KEYS = ("amenity", "emergency", "healthcare", "tourism", "leisure", "shop", "office", "craft", "historic",
            "man_made", "aeroway", "railway", "public_transport", "highway", "landuse", "building", "sport",
            "name", "official_name", "alt_name", "short_name", "operator", "operator:type", "isced:level", "grades",
            "school", "capacity", "beds", "rooms", "addr:housenumber", "addr:street", "addr:city", "addr:postcode",
            "website", "ref", "brand", "religion", "parking", "access", "fee", "stars", "cuisine", "denomination",
            "phone", "fire_station:type", "police", "station", "emergency:ambulance", "opening_hours")
POI_TRIGGERS = ("amenity", "emergency", "healthcare", "tourism", "leisure", "shop", "aeroway", "historic")
WATER_TAGS = {("natural", "water"), ("waterway", "riverbank"), ("landuse", "reservoir"), ("landuse", "basin"),
              ("water", "river"), ("water", "lake"), ("water", "reservoir"), ("water", "pond")}


def pick(tags, keys):
    return {k: tags[k] for k in keys if k in tags}


class Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.roads = []
        self.controls = {}
        self.buildings = []
        self.water = []
        self.waterways = []
        self.rail = []
        self.pois = []
        self.places = []

    # --- nodes ---------------------------------------------------------------------
    def node(self, n):
        t = n.tags
        if not len(t):
            return
        hw = t.get("highway")
        if hw in ("traffic_signals", "stop", "give_way", "crossing", "mini_roundabout", "turning_circle", "motorway_junction"):
            self.controls[n.id] = {"highway": hw, **pick(t, ("crossing", "traffic_signals", "direction", "traffic_signals:direction",
                                                              "stop", "name", "ref")), "lon": n.location.lon, "lat": n.location.lat}
        if t.get("railway") in ("level_crossing", "crossing"):
            self.controls.setdefault(n.id, {"lon": n.location.lon, "lat": n.location.lat})["railway"] = t.get("railway")
        if "place" in t:
            self.places.append({"id": n.id, "place": t["place"], "name": t.get("name"), "population": t.get("population"),
                                "lon": n.location.lon, "lat": n.location.lat})
        if any(k in t for k in POI_TRIGGERS) or t.get("public_transport") or t.get("man_made") in ("tower", "water_tower"):
            self.pois.append({"osm": f"n{n.id}", "lon": n.location.lon, "lat": n.location.lat, "area_m2": 0, **pick(t, POI_KEYS)})

    # --- ways ----------------------------------------------------------------------
    def way(self, w):
        t = w.tags
        hw = t.get("highway")
        if hw in DRIVABLE:
            try:
                coords = [(nd.lon, nd.lat) for nd in w.nodes]
            except osmium.InvalidLocationError:
                return
            self.roads.append({"id": w.id, "tags": pick(t, ROAD_KEYS), "nodes": [nd.ref for nd in w.nodes], "coords": coords})
        rw = t.get("railway")
        if rw in ("rail", "light_rail", "narrow_gauge", "abandoned", "disused", "spur", "siding", "yard"):
            if rw in ("rail", "narrow_gauge", "siding", "spur", "yard"):
                try:
                    self.rail.append({"id": w.id, "railway": rw, "service": t.get("service"), "name": t.get("name"),
                                      "coords": [(nd.lon, nd.lat) for nd in w.nodes], "bridge": t.get("bridge"), "tunnel": t.get("tunnel")})
                except osmium.InvalidLocationError:
                    pass
        ww = t.get("waterway")
        if ww in ("river", "stream", "canal"):
            try:
                self.waterways.append({"id": w.id, "waterway": ww, "name": t.get("name"),
                                       "coords": [(nd.lon, nd.lat) for nd in w.nodes]})
            except osmium.InvalidLocationError:
                pass

    # --- areas (closed ways and multipolygons) ------------------------------------------
    def area(self, a):
        t = a.tags
        is_bld = "building" in t and t.get("building") not in ("no",)
        is_water = any((k, t.get(k)) in WATER_TAGS for k in ("natural", "waterway", "landuse", "water"))
        is_poi = any(k in t for k in POI_TRIGGERS)
        if not (is_bld or is_water or is_poi):
            return
        try:
            polys = []
            for outer in a.outer_rings():
                ring = [(n.lon, n.lat) for n in outer]
                holes = [[(n.lon, n.lat) for n in inner] for inner in a.inner_rings(outer)]
                polys.append((ring, holes))
        except osmium.InvalidLocationError:
            return
        if not polys:
            return
        oid = ("w" if a.from_way() else "r") + str(a.orig_id())
        if is_bld:
            self.buildings.append({"osm": oid, "tags": pick(t, BLD_KEYS), "polys": polys})
        if is_water:
            self.water.append({"osm": oid, "name": t.get("name"), "kind": t.get("water") or t.get("waterway") or t.get("landuse") or "water",
                               "polys": polys})
        if is_poi:
            # Centroid of the largest ring (cheap; refined later with shapely if needed).
            ring = max((p[0] for p in polys), key=len)
            lon = sum(p[0] for p in ring) / len(ring)
            lat = sum(p[1] for p in ring) / len(ring)
            self.pois.append({"osm": oid, "lon": lon, "lat": lat, "ring": ring if len(ring) < 4000 else None,
                              "is_building": is_bld, **pick(t, POI_KEYS)})


if __name__ == "__main__":
    h = Handler()
    h.apply_file(str(PBF), locations=True, idx="flex_mem")
    print("roads", len(h.roads), "controls", len(h.controls), "buildings", len(h.buildings), "water", len(h.water),
          "waterways", len(h.waterways), "rail", len(h.rail), "pois", len(h.pois), "places", len(h.places))
    for name in ("roads", "controls", "buildings", "water", "waterways", "rail", "pois", "places"):
        with open(WORK / f"osm_{name}.pkl", "wb") as f:
            pickle.dump(getattr(h, name), f, protocol=pickle.HIGHEST_PROTOCOL)
    sys.exit(0)

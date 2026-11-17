"""Curated facts for the UI and for validation (data/facts.json).

From research/buncombe_facts.json (each fact carries its sources there): NCDOT traffic counts
at named locations (projected to sim coordinates), EMS response goals, tourism volume, leaf
timing, congestion benchmarks, and venue schedules.
"""
from __future__ import annotations

import json

from common import OUT, ROOT, project, save_json


def main():
    d = json.loads((ROOT / "research" / "buncombe_facts.json").read_text())
    counts = []
    for r in d["traffic"]["aadt_values"]:
        if r.get("lat") is None:
            continue
        x, z = project(r["lon"], r["lat"])
        years = {int(k): v for k, v in (r.get("aadt_by_year") or {}).items() if isinstance(v, (int, float))}
        if not years:
            continue
        latest = max(years)
        counts.append({"label": r.get("label") or r["location_requested"].replace("Extra: ", ""), "x": round(float(x), 1), "z": round(float(z), 1),
                       "aadt": years[latest], "year": latest, "station": r.get("ncdot_station_id")})
    ems = d["ems_stations"]["response_time_goals_and_performance"]
    cong = d["traffic"]["congestion"].get("tti_urban_mobility_report_2025", {})
    facts = {
        "traffic_counts": counts,
        "traffic_counts_source": "NCDOT AADT (annual average daily traffic), via the NCDOT traffic-count service",
        "ems": {"goal": "Buncombe County EMS goal: arrive within 8 minutes 59 seconds, 90% of the time.",
                "actual_2016_2022": "2016-2022: 17 min 17 s from 911 call to EMS arrival at the 90th percentile (county study).",
                "tiered_goals": ems.get("tiered_model_recommended_2022_study"),
                "bases_note": "Buncombe County EMS works mostly from fire stations; only EMS 9 (Reynolds) has a confirmed address. "
                              "Other bases are placed at the fire station in the area the county names and marked approximate."},
        "nfpa": {"engine_travel_s": 240, "ems_als_travel_s": 480, "call_processing_s": 60, "turnout_fire_s": 80, "turnout_ems_s": 60,
                 "note": "NFPA 1710 benchmarks for career departments: first engine within 4 minutes of travel, ALS within 8."},
        "hospitals": "Mission Hospital is Western North Carolina's only Level I trauma center (ACS, Dec 2025). The South Asheville ER in "
                     "Arden is a freestanding emergency department. AdventHealth Weaverville is under construction (2028).",
        "tourism": {"visitors_2023": 13900000, "overnight_2023": 5000000, "day_trips_2023": 9000000,
                    "hotel_rooms_2025": "just under 10,000 per night", "vacation_rentals_2025": "about 8,000",
                    "note": "Record 13.9 million visitors in 2023 (Explore Asheville). Hurricane Helene (Sept 2024) cut 2024-25 spending; "
                            "October leaf season remains the peak."},
        "leaf_peak": "Asheville (about 2,100 ft) peaks in the third to fourth week of October; Craggy Gardens and the highest peaks color "
                     "in early to mid October, and color moves downhill roughly 1,000 ft every 7-10 days.",
        "congestion": {"tti_delay_hours_2024": cong.get("annual_delay_per_auto_commuter_hours", {}).get("2024"),
                       "note": "Texas A&M Urban Mobility Report: about 52 hours of delay per auto commuter in 2024."},
        "projects_2026": d["traffic"].get("projects_2026"),
        "venues": [{k: v.get(k) for k in ("name", "capacity", "typical_event_times", "parking")} for v in d["venues"] if v.get("name")],
        "sources_file": "pipeline/research/buncombe_facts.json",
    }
    save_json(OUT / "facts.json", facts, indent=1)
    print("traffic counts", len(counts))


if __name__ == "__main__":
    main()

"""Run openrouteservice 9.10 locally on the Buncombe-area road network.

The same engine version as the public ORS API (9.10;
10.x drives metro roads ~25% faster). Graphs are built from
cache/ors/buncombe-roads.osm.pbf (roads-only, renumbered) into cache/ors/graphs and
reused on later starts.

  python ors_server.py start     # build (first run ~1-2 min) and serve on :8093
  python ors_server.py stop
"""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

import requests

from common import CACHE

JAVA = "/opt/homebrew/opt/openjdk/bin/java"
DIR = CACHE / "ors"
JAR = DIR / "ors-9.10.0.jar"
PBF = DIR / "buncombe-roads.osm.pbf"
GRAPHS = DIR / "graphs"
PORT = 8093
URL = f"http://localhost:{PORT}/ors/v2"
PIDFILE = DIR / "server.pid"

CONFIG = f"""server:
  port: {PORT}
ors:
  endpoints:
    matrix:
      maximum_routes: 250000
      maximum_visited_nodes: 100000000
      maximum_search_radius: 2000
    isochrones:
      maximum_range_time:
        - profiles: driving-car
          value: 7200
      maximum_intervals: 10
      maximum_locations: 5
  engine:
    graphs_data_access: MMAP
    elevation:
      cache_path: {GRAPHS}/elevation_cache
    profile_default:
      graph_path: {GRAPHS}
      build:
        source_file: {PBF}
        elevation: false
        instructions: false
    profiles:
      driving-car:
        enabled: true
        build:
          preparation:
            methods:
              ch:
                enabled: true
                threads: 4
                weightings: fastest
              lm:
                enabled: false
              core:
                enabled: false
          ext_storages:
            WayCategory:
              enabled: false
            HeavyVehicle:
              enabled: false
            Tollways:
              enabled: false
            WaySurfaceType:
              enabled: false
            RoadAccessRestrictions:
              enabled: false
"""


def ready():
    try:
        r = requests.get(f"{URL}/health", timeout=3)
        return r.status_code == 200 and r.json().get("status") == "ready"
    except requests.RequestException:
        return False


def start():
    if ready():
        print("ORS already running on", PORT)
        return
    cfg = DIR / "ors-config.yml"
    cfg.write_text(CONFIG)
    log = (DIR / "server.log").open("w")
    env = dict(os.environ, ORS_CONFIG_LOCATION=str(cfg))
    proc = subprocess.Popen([JAVA, "-Xmx4g", "-jar", str(JAR)], stdout=log, stderr=subprocess.STDOUT, env=env, cwd=DIR,
                            start_new_session=True)
    PIDFILE.write_text(str(proc.pid))
    t0 = time.time()
    while time.time() - t0 < 900:
        if proc.poll() is not None:
            print("ORS exited; see", DIR / "server.log")
            sys.exit(1)
        if ready():
            print(f"ORS ready on {PORT} after {time.time() - t0:.0f}s")
            return
        time.sleep(3)
    print("ORS did not become ready in time")
    sys.exit(1)


def stop():
    if PIDFILE.exists():
        pid = int(PIDFILE.read_text())
        try:
            os.killpg(os.getpgid(pid), signal.SIGTERM)
        except ProcessLookupError:
            pass
        PIDFILE.unlink()
        print("stopped", pid)


if __name__ == "__main__":
    {"start": start, "stop": stop}[sys.argv[1] if len(sys.argv) > 1 else "start"]()

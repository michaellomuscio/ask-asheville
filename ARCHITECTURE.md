# Architecture

The simulation runs entirely in the browser (Three.js, no build step) on data the Python
pipeline prepares. Everything under `src/sim/` and `src/data/` is rendering-free and also runs
under Node, which is how the tests and the headless calibration run.

```
pipeline/  (Python)  public data -> docs/data/*.bin.gz, docs/data/*.json
docs/                the published site
  data/              built assets (committed)
  src/data/          bundle reader, WorldData loader
  src/sim/           road graph, routing, traffic, demand, scenarios, emergency, clock, weather
  src/render/        Three.js scene: terrain, roads, buildings, water, vehicles, markers, overlays
  src/ui/            HUD panels, inspector, legends
  src/lab/           questions and answers, investigations, notebook (see the end of this file)
  vendor/            three.js and fonts, served with the site
tests/               node --test suites (sim only)
scripts/             dev server, headless runs
tools/               headless-Chrome driver and the question check
```

Paths below are relative to `docs/`.

## Coordinates and units

Meters on a local plane centered on Pack Square: `x` east, `z` south, `y` up. Speeds m/s,
times in seconds, clock in seconds since midnight. `data/manifest.json` has the projection
constants; `src/data/geo.js` mirrors `pipeline/common.py`.

## Data (src/data/worldData.js)

`loadWorldData(base, {onProgress, terrain, water})` resolves to:

| field | type | notes |
|---|---|---|
| `roads` | `RoadNetwork` (src/sim/graph.js) | nodes, directed edges, polylines, CSR adjacency, spatial index |
| `buildings` | `Buildings` | 184,954 footprints; `kind`, `units`, `households`, `residents`, `jobs`, `kids10`, `node` (snapped road node), `bg` (block group index), `block` |
| `areas` | JSON | `metrics` definitions; `bg` (168 block groups: metrics, `leave_time` departure bins, `mode` shares), `block` (4,841), `zip` (19) |
| `pois` | array | `{kind, sub, name, x, z, node, ...}` kinds: hospital, fire, ems, police, school, college, venue, brewery, hotel, parking, place |
| `demand` | `Demand` | LODES flows `odHome/odWork/odCount` (block index; negative = corridor `-1-i`), `corridors[i].enter/exit` gateway nodes, school flows `schSchool/schBlock/schCount`, `schools[]` |
| `terrain` | `Terrain` | 30 m heights + NLCD land cover, `sample(x,z)` |
| `focus` | poi | Default destination for drive times: downtown Asheville (Pack Square). The app's current destination is `app.dest` (any place, saved in prefs). |

### RoadNetwork essentials

- Node arrays: `nodeX, nodeZ, nodeY` (Y filled by the renderer), `nodeSignal`, `nodeInCounty`, `nodeGateway`.
- Edge arrays (directed): `from, to, len, speed` (ORS-calibrated free flow, m/s), `vsim` (speed simulated
  drivers aim for), `posted` (km/h), `lanes` (this direction), `cls`, `rank` (junction priority, higher
  wins), `flags` (bridge 1, tunnel 2, roundabout 4, oneway 8), `ctrl` (control at the downstream end:
  0 none, 1 yield, 2 stop, 3 signal), `geom`, `dir` (+1 follows the polyline, -1 runs it backward), `twin`.
- `ffTime[e] = len/speed` seconds. Every drive time shown to the user is built on `ffTime`.
- `outStart/outEdges`, `inStart/inEdges`: CSR adjacency. `pointAt(e, s, out)` gives centerline
  position and unit direction at `s` meters along edge `e`; `laneOffset(e, lane)` the lateral offset.
- `nearestNode(x, z, filter)`, `nearestSegment(x, z)`.

### Router (src/sim/router.js)

`dijkstra(sources, weights, {reverse, maxTime, out, pred, label})` (~5 ms for the whole county)
and `route(from, to, weights)` A* (~1 ms per random county trip).

## Drive-time semantics

- **Free flow** = ORS-consistent (`ffTime`). Matches openrouteservice drive times.
- **Live** = `ffTime[e] * congestion[e]`, where `congestion[e] >= 1` is the ratio of the simulated
  traversal time to the simulated free-flow traversal time (`len / vsim`) on that edge. Simulated cars
  drive at realistic posted speeds; only the *ratio* feeds the numbers, so live is never faster than
  free flow and both agree at 3 a.m.
- **Typical** (e.g. "8 a.m. weekday") = hourly congestion ratios recorded from a full simulated day
  (`data/typical_*.bin.gz`, produced by `scripts/headless.js`), applied the same way.

## World API (src/sim/world.js) — consumed by the renderer and UI

```js
const world = new World(data, { seed, scenario: 'weekday', demand: 1.0, sample: 1.0, startHour: 6.5 });
world.step(realDt, simSecondsPerRealSecond)   // advances clock, demand, traffic, emergencies
world.clock          // .t (s since midnight), .hour, .date (Date), .dayOfWeek (0=Sun), .label(), .setHour(h)
world.weather        // Signal City Weather API (+ 'snow'): kind, cloud, rain, fog, wind, wet, flash, setMode(), temperature()
world.vehicles       // array of active vehicles (see below); renderer reads it every frame
world.pose(v, out)   // out.x/y/z (lane-offset position), out.dx/dy/dz (unit heading incl. grade)
world.stats()        // {active, avgSpeedKmh, congestionIndex, stoppedShare, completedToday, avgTripMin, avgDelayMin}
world.congestion     // Float32Array(E) live ratio >= 1
world.liveWeights()  // Float32Array(E) = ffTime * congestion (cached per tick)
world.typicalWeights(hour, kind)  // Float32Array(E) from the typical profile ('weekday'|'saturday'...)
world.scenarios      // [{id, label, description, ...}]; world.setScenario(id)
world.setDemand(f)   // traffic demand multiplier (0.1-2.0)
world.setSample(f)   // share of trips simulated as vehicles (capacity scaled to match)
world.events         // [{id, label, venue, active, attendance, start, end}]; world.setEvent(id, patch)
world.emergency      // see below
world.net, world.router, world.data
```

Vehicle object (read-only for the renderer):

```js
{ id, type, len, wid, color, edge, s, lane, v, acc, brake, turn /* -1 left, 0, 1 right */, fade /* 0..1 */,
  siren /* emergency lights on */, purpose, fromBuilding, toBuilding, departed, plate }
// type: 'sedan' | 'hatch' | 'suv' | 'van' | 'truck' | 'semi' | 'bus' | 'schoolbus' | 'ambulance' | 'engine' | 'police'
```

Emergency (src/sim/emergency.js):

```js
world.emergency.stations        // [{id, kind: 'fire'|'ems'|'police'|'hospital', name, node, x, z, units}]
world.emergency.call({type, x, z})  // type: 'medical' | 'fire' | 'crash' | 'police' -> Incident
// Incident: {id, type, x, z, node, status, created, units: [{kind, station, vehicle, route, etaSec, arrived}],
//            timeline: [{t, label}], hospital?, transportEtaSec?}
world.emergency.incidents
world.emergency.responseTimes(kind, {live, extra}) // Float32Array(nodes): seconds from 911 call to arrival
```

## Rendering (src/render/)

Terrain: one mesh at 60 m (chunked for culling) built from the 30 m heights; per-pixel normals from a
height texture; land-cover colors; an overlay pass that colors areas through `data/areas_id.png`
(block id in RG, ZIP id in B) and a lookup texture, and drive-time heat maps through a node-time
texture. Road and building heights are sampled from that same mesh so nothing floats or sinks.
Buildings: per-tile merged meshes with a per-building data texture (color, height, data value).
Vehicles: Signal City's instanced models within ~2 km of the camera, glowing points beyond.

## The student layer (docs/src/lab/)

The question-and-answer layer. It sits on top of the `App` in
`main.js` (reachable as `window.asheville`; the layer itself is `asheville.labUI`).

| module | what it owns |
|---|---|
| `catalog.js` | `METRICS`: every map measure in plain words, the phrases that mean it, its evidence label. `BADGES`, `GLOSSARY`. |
| `gazetteer.js` | `Gazetteer`: towns (exact Census blocks from `data/places.json`), neighborhoods and communities (map labels and a few hand-placed parts of Asheville), schools, landmarks, stations and major roads, with nicknames. `find(question)` returns the places named; `describe(x, z)` gives words for where a point is. |
| `core.js` | `Lab`: the arithmetic. `stat(entity, measure)`, `rank`, `rankTowns`, `relate` (correlation), `drive`, `reach`, `nearest`, `response`, `bestNewStation`, `slowRoads`, `roadNow`, `extremes`, `zoned`, `totals`, and "my spot". No HTML. |
| `ask.js` | `Asker`: `parse(question)` finds places, measures, direction, time of day, day type, service and category; `route(q)` picks an answerer; each answerer returns an answer object `{kind, headline, sub, figures[{label, value, badge}], chart, table, sources, caveat, map, follow, show()}`. `show()` applies the evidence to the map. An unreadable question returns `{miss: true}` with suggestions; a question about data the map lacks says so. `QUESTION_BANK` is the tested list of examples. |
| `ui.js` | `LabUI` (ask bar, answer card, Questions and Layers panels, welcome, notebook button, `#q=` links), `MapView` (every map action an answer can take, and framing the view in the space the panels leave open), `Pins`. |
| `charts.js` | bars, histogram, scatter and line charts as inline SVG. |
| `investigations.js` | `INVESTIGATIONS` and `Guide`: the guided Predict, Explore, Explain, Extend sequences. |
| `notebook.js` | `Notebook`: evidence cards, the Claim-Evidence-Reasoning write-up, print and download. Stored only in the browser. |

Rules the layer keeps:

- Every number shown carries a badge: counted, surveyed, simulated or measured.
- Nothing is hard-coded that the data can compute; prose facts come from `data/facts.json`.
- People are reported for Census areas only, never for one building.
- No network requests beyond the site's own static files (three.js and the fonts are served from `docs/vendor/`).

`npm run test:questions` asks every example, every follow-up an answer suggests, and a top/bottom and
town question for every measure, in headless Chrome, and fails on any the engine can't answer.

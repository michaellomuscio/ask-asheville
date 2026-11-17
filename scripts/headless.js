// Run whole simulated days in Node, without rendering.
//
//   node scripts/headless.js                       # weekday + Saturday, full demand, writes data/typical_*
//   node scripts/headless.js --day weekday --sample 0.5 --from 6 --to 10 --no-write [--seed 7] [--out dir]
//
// Records hourly per-edge congestion ratios (the "typical rush hour" drive times use them),
// daily volumes at NCDOT count stations (compared with AADT), trip totals, VMT, and drive times
// to downtown Asheville from around the county at 8 a.m. versus free flow.
// Writes data/typical_<day>.bin.gz (ASV1 bundle) and data/typical_summary.json.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from '../docs/src/data/worldData.js';
import { project } from '../docs/src/data/geo.js';
import { World } from '../docs/src/sim/world.js';
import { CLASS } from '../docs/src/sim/graph.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'docs', 'data');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);
const DAYS = (opt('day', 'weekday,saturday')).split(',');
const SAMPLE = Number(opt('sample', '1'));
const FROM = Number(opt('from', '0'));
const TO = Number(opt('to', '24'));
const SEED = Number(opt('seed', '2026'));
const OUT = path.resolve(opt('out', DATA)); // where typical_* files go
const WRITE = !flag('no-write');
const SCALE = 40; // ratio_q = (ratio - 1) * SCALE, clamped 0..255
const SCENARIO_OF = { weekday: 'weekday', saturday: 'saturday', sunday: 'sunday' };

/** Minimal ASV1 writer (see pipeline/bundle.py). */
function writeBundle(file, meta, arrays) {
  const DT = { Float32Array: 'f4', Int32Array: 'i4', Uint32Array: 'u4', Int16Array: 'i2', Uint16Array: 'u2', Int8Array: 'i1', Uint8Array: 'u1' };
  const table = {};
  const blobs = [];
  let off = 0;
  for (const [name, arr] of Object.entries(arrays)) {
    const pad = (8 - (off % 8)) % 8;
    if (pad) {
      blobs.push(Buffer.alloc(pad));
      off += pad;
    }
    table[name] = { dtype: DT[arr.constructor.name], offset: off, length: arr.length };
    const b = Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
    blobs.push(b);
    off += b.length;
  }
  let header = Buffer.from(JSON.stringify({ meta, arrays: table }));
  const hp = (8 - ((header.length + 8) % 8)) % 8;
  header = Buffer.concat([header, Buffer.alloc(hp, 0x20)]);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(header.length);
  const raw = Buffer.concat([Buffer.from('ASV1'), len, header, ...blobs]);
  fs.writeFileSync(file, zlib.gzipSync(raw, { level: 9 }));
}

function stationEdges(net, st) {
  const { x, z } = project(st.lon, st.lat);
  // Interstate stations name the interstate first ("I-40 near ...", "Extra: I-26 between ...").
  const interstate = /^(Extra: )?I[- ]\d/.test(st.location_requested);
  const geoms = new Map();
  // Polyline segments within 80 m of the station point.
  for (let g = 0; g < net.geomCount; g++) {
    const o0 = net.geomOff[g];
    const o1 = net.geomOff[g + 1];
    if (Math.abs(net.gx[o0] - x) > 4000 && Math.abs(net.gx[o1 - 1] - x) > 4000) continue;
    for (let i = o0; i < o1 - 1; i++) {
      const ax = net.gx[i]; const az = net.gz[i];
      const vx = net.gx[i + 1] - ax; const vz = net.gz[i + 1] - az;
      const L = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L));
      const d = Math.hypot(ax + vx * t - x, az + vz * t - z);
      if (d < (interstate ? 80 : 150) && (!geoms.has(g) || d < geoms.get(g).d)) geoms.set(g, { d, hx: vx / Math.sqrt(L), hz: vz / Math.sqrt(L) });
    }
  }
  // Highest-ranked road class near the point (freeways for interstate stations).
  let best = 0;
  for (const g of geoms.keys()) {
    const e = net.geomEdge[g];
    const ok = interstate ? net.cls[e] === CLASS.MOTORWAY : net.cls[e] !== CLASS.MOTORWAY && net.cls[e] !== CLASS.MOTORWAY_LINK;
    if (ok && net.rank[e] > best) best = net.rank[e];
  }
  // One edge per direction of travel: the closest one heading each way.
  let ref = null;
  const pick = [null, null];
  for (const [g, info] of geoms) {
    const e0 = net.geomEdge[g];
    if (net.rank[e0] !== best || (interstate && net.cls[e0] !== CLASS.MOTORWAY)) continue;
    for (const e of net.edgesOfGeom(g)) {
      const sgn = net.dir[e] > 0 ? 1 : -1;
      const hx = info.hx * sgn;
      const hz = info.hz * sgn;
      if (!ref) ref = [hx, hz];
      const side = hx * ref[0] + hz * ref[1] >= 0 ? 0 : 1;
      if (!pick[side] || info.d < pick[side].d) pick[side] = { e, d: info.d };
    }
  }
  return pick.filter(Boolean).map((p) => p.e);
}

async function runDay(data, dayKey, research) {
  const scenario = SCENARIO_OF[dayKey] || dayKey;
  const t0 = Date.now();
  const world = new World(data, { scenario, seed: SEED, sample: SAMPLE, startHour: FROM, budgetMs: Infinity });
  const net = world.net;
  const E = net.edgeCount;
  const tr = world.traffic;
  // Count stations: edges at each NCDOT AADT point, deduplicated per geometry direction.
  const stations = (research?.traffic?.aadt_values || []).map((st) => {
    const edges = stationEdges(net, st);
    const years = Object.keys(st.aadt_by_year).map(Number).sort();
    const aadt = st.aadt_by_year[years[years.length - 1]];
    return { name: st.location_requested, aadt, year: years[years.length - 1], edges, hourly: new Float64Array(24) };
  });
  const stationOfEdge = new Map();
  stations.forEach((s, i) => s.edges.forEach((e) => {
    if (!stationOfEdge.has(e)) stationOfEdge.set(e, []);
    stationOfEdge.get(e).push(i);
  }));
  let vmt = 0;
  let trips = 0;
  let tripSec = 0;
  let tripFF = 0;
  const onArrive = tr.onArrive;
  tr.onArrive = (v, t, lifted) => {
    if (!lifted && !v.emUnit) {
      trips++;
      tripSec += t - v.departed;
      tripFF += v.ff;
    }
    onArrive(v, t, lifted);
  };
  tr.onEdgeExit = (e, v) => {
    vmt += net.len[e];
    const list = stationOfEdge.get(e);
    if (list) {
      const h = Math.floor(world.clock.hour);
      for (const i of list) stations[i].hourly[h] += tr.capScale;
    }
  };
  // Hourly congestion: mean of the live ratio sampled every minute.
  const sum = new Float32Array(24 * E);
  const cnt = new Uint16Array(24);
  const hourly = [];
  let lastMin = -1;
  let peak = 0;
  let peakAt = '';
  const steps = Math.round(((TO - FROM) * 3600) / 0.5);
  const destNode = data.focus?.node;
  const origins = {
    'South Asheville (Biltmore Park)': [2300, 12500],
    'West Asheville (Haywood Rd)': [-3600, 900],
    'North Asheville (UNCA)': [-1450, -2330],
    Weaverville: [-1000, -10500],
    'Black Mountain': [20700, -2600],
    'Candler / Enka': [-9500, 4800],
    'Arden (Airport Rd)': [700, 15000],
    Fairview: [13800, 7600],
  };
  const originNodes = Object.fromEntries(Object.entries(origins).map(([k, [x, z]]) => [k, net.nearestNode(x, z)]));
  let dest8 = null;
  let demand = world.demandMaker.summary;
  let lastLog = Date.now();
  for (let k = 0; k < steps; k++) {
    world.tick(0.5, 0.01);
    // The day's demand (the last step lands on midnight and starts the next day).
    if (k < steps - 1) demand = world.demandMaker.summary;
    const minute = Math.floor(world.clock.t / 60);
    if (minute !== lastMin) {
      lastMin = minute;
      const h = Math.floor(minute / 60) % 24;
      const c = tr.congestion;
      const off = h * E;
      for (let e = 0; e < E; e++) sum[off + e] += c[e];
      cnt[h]++;
      const st = tr.stats();
      if (st.active > peak) {
        peak = st.active;
        peakAt = world.clock.label();
      }
      if (minute % 60 === 0) {
        hourly.push({ hour: h, active: Math.round(st.active / SAMPLE), kmh: +st.avgSpeedKmh.toFixed(1), stopped: +(st.stoppedShare * 100).toFixed(1),
          completed: Math.round(st.completed / SAMPLE), lifted: st.lifted, noRoom: world.counters.droppedNoRoom });
        if (!flag('quiet')) {
          const dt = ((Date.now() - lastLog) / 1000).toFixed(0);
          lastLog = Date.now();
          console.log(`${dayKey} ${world.clock.label()} active ${Math.round(st.active / SAMPLE)} (sim ${st.active}) ${st.avgSpeedKmh.toFixed(1)} km/h stopped ${(st.stoppedShare * 100).toFixed(0)}% done ${st.completed} lifted ${st.lifted} rerouted ${st.rerouted} noRoom ${world.counters.droppedNoRoom} late ${world.counters.late} wall ${dt}s`);
        }
      }
      if (minute === 8 * 60 && destNode != null) {
        dest8 = {};
        const live = world.liveWeights();
        for (const [name, n] of Object.entries(originNodes)) {
          const ff = world.router.routeALT(n, destNode, net.ffTime);
          const lv = world.router.routeALT(n, destNode, live);
          dest8[name] = { freeFlowMin: +(ff.time / 60).toFixed(1), at8amMin: +(lv.time / 60).toFixed(1) };
        }
      }
    }
  }
  const ratioQ = new Uint8Array(24 * E);
  for (let h = 0; h < 24; h++) {
    const n = cnt[h];
    for (let e = 0; e < E; e++) {
      const r = n ? sum[h * E + e] / n : 1;
      ratioQ[h * E + e] = Math.max(0, Math.min(255, Math.round((r - 1) * SCALE)));
    }
  }
  // Most congested corridors (length-weighted ratio, grouped by road name) at 8 am and 5 pm.
  const corridor = (h) => {
    const by = new Map();
    for (let e = 0; e < E; e++) {
      const r = 1 + ratioQ[h * E + e] / SCALE;
      const name = net.names[net.nameId[e]];
      if (!name || net.len[e] < 30) continue;
      const g = by.get(name) || { len: 0, w: 0 };
      g.len += net.len[e];
      g.w += net.len[e] * r;
      by.set(name, g);
    }
    return [...by.entries()].filter(([, g]) => g.len > 800).map(([n, g]) => ({ road: n, km: +(g.len / 1000).toFixed(1), ratio: +(g.w / g.len).toFixed(2) }))
      .sort((a, b) => b.ratio - a.ratio).slice(0, 12);
  };
  const st = tr.stats();
  const res = {
    day: dayKey,
    scenario: world.scenario.id,
    date: world.scenario.date,
    sample: SAMPLE,
    hours: [FROM, TO],
    wallSeconds: Math.round((Date.now() - t0) / 1000),
    vehicleTrips: Math.round(trips / SAMPLE),
    vehicleKmTraveled: Math.round((vmt / 1000) * tr.capScale),
    peakActiveVehicles: Math.round(peak / SAMPLE),
    peakAt,
    avgTripMin: +(tripSec / Math.max(1, trips) / 60).toFixed(1),
    avgFreeFlowMin: +(tripFF / Math.max(1, trips) / 60).toFixed(1),
    lifted: st.lifted,
    rerouted: st.rerouted,
    droppedNoRoom: world.counters.droppedNoRoom,
    demand,
    hourly,
    toDowntownAt8am: dest8,
    congested8am: corridor(8),
    congested5pm: corridor(17),
    stations: stations.map((s) => ({ name: s.name, aadt: s.aadt, aadtYear: s.year, simDaily: Math.round(s.hourly.reduce((a, b) => a + b, 0)),
      simPeakHour: Math.round(Math.max(...s.hourly)), edges: s.edges.length })),
  };
  return { res, ratioQ };
}

const data = await loadWorldData(DATA + '/', { terrain: false, water: false });
const researchFile = path.join(ROOT, 'pipeline/research/buncombe_facts.json');
const research = fs.existsSync(researchFile) ? JSON.parse(fs.readFileSync(researchFile, 'utf8')) : null;
// Merge into an existing summary so days can be run in separate processes.
if (WRITE) fs.mkdirSync(OUT, { recursive: true });
const summaryFile = path.join(OUT, 'typical_summary.json');
const summary = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : { days: {} };
summary.generated = new Date().toISOString();
summary.note = 'Simulated with scripts/headless.js; volumes scaled to full demand (sample < 1 scales lane capacity to match).';
for (const day of DAYS) {
  const { res, ratioQ } = await runDay(data, day, research);
  summary.days[day] = res;
  console.log(JSON.stringify({ ...res, hourly: undefined }, null, 1));
  if (WRITE && FROM === 0 && TO === 24) {
    writeBundle(path.join(OUT, `typical_${day}.bin.gz`), {
      day, scenario: res.scenario, date: res.date, scale: SCALE, hours: 24, edges: data.roads.edgeCount,
      encoding: 'ratio_q[h * E + e] = round((congestion ratio - 1) * scale); mean of minute samples of the live ratio during hour h',
    }, { ratio_q: ratioQ });
  }
}
if (WRITE && FROM === 0 && TO === 24) {
  // Re-read in case another process finished a different day meanwhile.
  const latest = fs.existsSync(summaryFile) ? JSON.parse(fs.readFileSync(summaryFile, 'utf8')) : { days: {} };
  latest.generated = summary.generated;
  latest.note = summary.note;
  latest.days = { ...(latest.days || {}), ...summary.days };
  fs.writeFileSync(summaryFile, JSON.stringify(latest, null, 1));
}

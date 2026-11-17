// The calculations behind every answer: facts about an area, rankings, drive times, who can reach
// what, emergency response, and the map actions that show the evidence. Nothing here builds HTML.

import { METRICS, METRIC_BY_ID } from './catalog.js';
import { Gazetteer } from './gazetteer.js';

const MI = 1609.34;
const BASIS_LABEL = { free: 'with no traffic', am: 'at 8 a.m. on a school day', pm: 'at 5:30 p.m. on a school day', live: 'in the simulation right now' };

export class Lab {
  constructor(app, places) {
    this.app = app;
    this.data = app.data;
    this.net = app.net;
    this.areas = app.data.areas;
    this.places = places;
    this.gaz = new Gazetteer(app.data, places);
    this.metrics = METRICS.filter((m) => this.areas[this.geoOf(m.id)] && this.areas[this.geoOf(m.id)][m.id]);
    this.mySpot = null; // {x, z, node, name, building?}: a starting point the student picked, kept on this device
    this.blockXY = this.gaz.blockCenters();
    // Buildings and jobs in every block, for totals.
    const b = this.data.buildings;
    const nb = this.areas.block.geoid.length;
    this.blockJobs = new Float64Array(nb);
    this.blockBuildings = new Int32Array(nb);
    for (let i = 0; i < b.count; i++) {
      const k = b.block[i];
      if (k >= 0) { this.blockJobs[k] += b.jobs[i]; this.blockBuildings[k]++; }
    }
  }

  geoOf(id) {
    const m = this.areas.metrics.find((x) => x.id === id);
    return m ? m.geo : 'bg';
  }

  metric(id) {
    return METRIC_BY_ID[id];
  }

  unitOf(id) {
    return this.areas.metrics.find((x) => x.id === id)?.unit || 'num';
  }

  // --- Areas -------------------------------------------------------------------------------------------

  /** Census blocks that make up an entity: exact for towns and the county, a circle for other places. */
  blocksOf(ent) {
    if (ent._blocks) return ent._blocks;
    const n = this.areas.block.geoid.length;
    const out = [];
    if (ent.type === 'county') for (let k = 0; k < n; k++) out.push(k);
    else if (ent.type === 'town') this.places.block_place.forEach((t, k) => { if (t === ent.town) out.push(k); });
    else {
      const r = ent.radius || 1000;
      const { x, z, w } = this.blockXY;
      for (let k = 0; k < n; k++) if (w[k] && Math.hypot(x[k] - ent.x, z[k] - ent.z) <= r) out.push(k);
    }
    ent._blocks = out;
    return out;
  }

  /** Block groups for an entity: every one with a block inside it (towns) or its center inside the circle. */
  bgsOf(ent) {
    if (ent._bgs) return ent._bgs;
    const bg = this.areas.bg;
    let out = [];
    if (ent.type === 'county') out = bg.geoid.map((_, i) => i);
    else if (ent.type === 'town') {
      // Block groups with most of their people inside the town.
      const inPop = new Float64Array(bg.geoid.length);
      const allPop = new Float64Array(bg.geoid.length);
      const blk = this.areas.block;
      for (let k = 0; k < blk.geoid.length; k++) {
        allPop[blk.bg[k]] += blk.pop[k];
        if (this.places.block_place[k] === ent.town) inPop[blk.bg[k]] += blk.pop[k];
      }
      for (let i = 0; i < inPop.length; i++) if (allPop[i] > 0 && inPop[i] / allPop[i] > 0.5) out.push(i);
    } else {
      const r = ent.radius || 1000;
      let near = -1;
      let nd = Infinity;
      bg.center.forEach((c, i) => {
        const d = Math.hypot(c[0] - ent.x, c[1] - ent.z);
        if (d <= r) out.push(i);
        if (d < nd) { nd = d; near = i; }
      });
      // A small place may sit inside one large block group.
      const here = this.app.overlays.areaAt(ent.x, ent.z).bg;
      if (!out.length) out = [here >= 0 ? here : near];
    }
    ent._bgs = out;
    return out;
  }

  /** 2020 Census population of an entity (sum of its blocks). */
  pop2020(ent) {
    const pop = this.areas.block.pop;
    let s = 0;
    for (const k of this.blocksOf(ent)) s += pop[k];
    return s;
  }

  /**
   * A measure for an entity.
   * Returns {value, how: 'official' | 'blocks' | 'blockgroups', n, moe, badge} or null.
   *   official     the Census Bureau's own value for the town, county, state or nation
   *   blocks       added up from 2020 Census blocks (exact for counts)
   *   blockgroups  a population-weighted average of the block groups around a place (approximate)
   */
  stat(ent, id) {
    const m = METRIC_BY_ID[id];
    if (!m) return null;
    const geo = this.geoOf(id);
    if (geo === 'block') {
      const blocks = this.blocksOf(ent);
      const blk = this.areas.block;
      let num = 0; let den = 0;
      const weight = id === 'hh_size_b' || id === 'pct_renter_b' ? blk.occupied : id === 'pct_vacant_b' ? blk.units : blk.pop;
      if (id === 'jobs_density_b') {
        let jobs = 0;
        for (const k of blocks) jobs += this.blockJobs[k];
        return { value: jobs, how: 'blocks', n: blocks.length, badge: 'counted', asCount: 'jobs' };
      }
      if (id === 'density_b') return this.stat(ent, 'density');
      for (const k of blocks) {
        const v = blk[id][k];
        if (v === null || !Number.isFinite(v)) continue;
        num += v * weight[k]; den += weight[k];
      }
      return den ? { value: num / den, how: 'blocks', n: blocks.length, badge: 'counted' } : null;
    }
    const official = ent.type === 'town' ? ent.official : ent.type === 'county' ? this.places.county : ent.wider;
    if (official && official.m && official.m[id] !== null && official.m[id] !== undefined) {
      return { value: official.m[id], how: 'official', moe: official.moe?.[id], badge: 'surveyed' };
    }
    const bgs = this.bgsOf(ent);
    const bg = this.areas.bg;
    if (id === 'population') {
      return { value: this.pop2020(ent), how: 'blocks', n: this.blocksOf(ent).length, badge: 'counted' };
    }
    if (id === 'density') {
      let p = 0; let a = 0;
      for (const i of bgs) { p += bg.population[i] || 0; a += bg.land_km2[i] || 0; }
      return a ? { value: p / (a / 2.58999), how: 'blockgroups', n: bgs.length, badge: 'surveyed' } : null;
    }
    let num = 0; let den = 0; let lo = Infinity; let hi = -Infinity;
    for (const i of bgs) {
      const v = bg[id][i];
      const w = bg.population[i] || 0;
      if (v === null || !Number.isFinite(v) || !w) continue;
      num += v * w; den += w;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return den ? { value: num / den, how: 'blockgroups', n: bgs.length, lo, hi, badge: 'surveyed' } : null;
  }

  /** North Carolina and the United States, for "is that a lot?" comparisons. */
  wider(id) {
    const out = [];
    for (const key of ['county', 'state', 'us']) {
      const w = this.places[key];
      const v = w?.m?.[id];
      if (v !== null && v !== undefined) out.push({ name: w.name, value: v });
    }
    return out;
  }

  /**
   * The top or bottom areas for a measure.
   * dir 'hi' | 'lo'. Returns {metric, geo, rows: [{unit, value, x, z, where, pop}], county, min, max, count}.
   */
  rank(id, dir = 'hi', n = 3) {
    const m = METRIC_BY_ID[id];
    let geo = this.geoOf(id);
    let vals = this.areas[geo][id];
    const rows = [];
    if (id === 'jobs_density_b') {
      // Jobs are easier to read as a count for each neighborhood-sized area than as a density for one block.
      const bg = this.areas.bg;
      const jobs = new Float64Array(bg.geoid.length);
      this.blockJobs.forEach((j, k) => { jobs[this.areas.block.bg[k]] += j; });
      vals = Array.from(jobs);
      geo = 'bg';
      for (let i = 0; i < vals.length; i++) rows.push({ unit: i, value: vals[i], x: bg.center[i][0], z: bg.center[i][1], pop: bg.population[i] });
    } else if (geo === 'bg') {
      const bg = this.areas.bg;
      for (let i = 0; i < vals.length; i++) {
        const v = vals[i];
        if (v === null || !Number.isFinite(v) || (bg.population[i] || 0) < 300) continue;
        rows.push({ unit: i, value: v, x: bg.center[i][0], z: bg.center[i][1], pop: bg.population[i] });
      }
    } else {
      const blk = this.areas.block;
      const minPop = m.minPop ?? 60;
      const minUnits = m.minUnits ?? 0;
      for (let k = 0; k < vals.length; k++) {
        const v = vals[k];
        if (v === null || !Number.isFinite(v) || blk.pop[k] < minPop || blk.units[k] < minUnits || !this.blockXY.w[k]) continue;
        rows.push({ unit: k, value: v, x: this.blockXY.x[k], z: this.blockXY.z[k], pop: blk.pop[k] });
      }
    }
    rows.sort((a, b) => (dir === 'hi' ? b.value - a.value : a.value - b.value));
    // Skip near-duplicates: the next area must be at least 600 m from the ones already chosen.
    const top = [];
    for (const r of rows) {
      if (top.every((t) => Math.hypot(t.x - r.x, t.z - r.z) > 600)) top.push(r);
      if (top.length >= n) break;
    }
    for (const r of top) r.where = this.gaz.describe(r.x, r.z);
    const sorted = rows.map((r) => r.value).sort((a, b) => a - b);
    const ties = rows.filter((r) => Math.abs(r.value - rows[0].value) < 1e-9).length;
    return {
      metric: m, geo, rows: top, count: rows.length, ties, values: vals, asCount: id === 'jobs_density_b', min: sorted[0], max: sorted[sorted.length - 1],
      median: sorted[Math.floor(sorted.length / 2)], county: this.stat(this.gaz.county, id),
    };
  }

  /** The towns ranked by a measure (official values). */
  rankTowns(id, dir = 'hi') {
    const rows = this.gaz.towns.map((t) => ({ ent: t, s: this.stat(t, id) })).filter((r) => r.s && Number.isFinite(r.s.value));
    rows.sort((a, b) => (dir === 'hi' ? b.s.value - a.s.value : a.s.value - b.s.value));
    return rows;
  }

  /** Paired values of two block-group measures and how strongly they move together. */
  relate(idA, idB) {
    const bg = this.areas.bg;
    const a = bg[idA]; const b = bg[idB];
    const pts = [];
    for (let i = 0; i < a.length; i++) {
      if (a[i] === null || b[i] === null || !Number.isFinite(a[i]) || !Number.isFinite(b[i]) || (bg.population[i] || 0) < 300) continue;
      pts.push({ x: a[i], y: b[i], unit: i });
    }
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.x, 0) / n;
    const my = pts.reduce((s, p) => s + p.y, 0) / n;
    let sxy = 0; let sxx = 0; let syy = 0;
    for (const p of pts) { sxy += (p.x - mx) * (p.y - my); sxx += (p.x - mx) ** 2; syy += (p.y - my) ** 2; }
    const r = sxy / Math.sqrt(sxx * syy);
    const slope = sxy / sxx;
    return { pts, n, r, slope, intercept: my - slope * mx };
  }

  // --- Roads and time -----------------------------------------------------------------------------

  basisLabel(b) {
    return BASIS_LABEL[b];
  }

  /** Fastest drive between two entities under each kind of traffic. */
  drive(from, to) {
    const out = { from, to, times: {} };
    let best = null;
    for (const basis of ['free', 'am', 'pm', 'live']) {
      const r = this.app.router.route(from.node, to.node, this.app.weights(basis));
      if (!r) return null;
      out.times[basis] = r.time;
      if (basis === 'free') best = r;
      if (basis === 'live') out.liveRoute = r;
    }
    out.miles = best.length / MI;
    out.route = best;
    out.straightMiles = Math.hypot(from.x - to.x, from.z - to.z) / MI;
    // The roads that carry most of the trip, in order.
    const net = this.net;
    const byName = new Map();
    for (const e of best.edges) {
      const nm = net.names[net.nameId[e]];
      if (!nm) continue;
      byName.set(nm, (byName.get(nm) || 0) + net.len[e]);
    }
    out.roads = [...byName.entries()].filter(([, len]) => len > 800).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([nm]) => nm);
    return out;
  }

  /** People living within each number of minutes of an entity. */
  reach(ent, basis = 'free', minutes = [5, 10, 15, 20, 30]) {
    const times = this.app.timesTo(ent.node, basis);
    return { times, ...this.app.reachStats(times, minutes) };
  }

  /** The closest places of a kind to an entity by drive time (no traffic). toward=true: they drive to it. */
  nearest(kinds, ent, n = 3, filter = null, toward = false) {
    const times = toward ? this.app.timesTo(ent.node, 'free') : this.app.timesFrom(ent.node, 'free');
    const rows = [];
    for (const p of this.data.pois) {
      if (!kinds.includes(p.kind) || (filter && !filter(p))) continue;
      if (p.node === undefined || p.node < 0) continue;
      const t = times[p.node];
      if (Number.isFinite(t)) rows.push({ poi: p, sec: t, miles: Math.hypot(p.x - ent.x, p.z - ent.z) / MI });
    }
    rows.sort((a, b) => a.sec - b.sec);
    return rows.slice(0, n);
  }

  /** Seconds from a 911 call to the first unit arriving at an entity, and the county-wide picture. */
  response(kind, ent = null, live = false) {
    const em = this.app.world.emergency;
    const extra = this.app.extraStations.filter((s) => s.kind === kind || kind === 'medical');
    const times = em.responseTimes(kind, { live, extra });
    const out = { kind, times };
    if (ent) {
      const node = em.nodeAt ? em.nodeAt(ent.x, ent.z) : ent.node;
      out.at = times[node];
      // Which station is closest by road.
      const st = this.nearest(kind === 'medical' ? ['fire', 'ems'] : [kind === 'hospital' ? 'hospital' : kind], ent, 1, kind === 'hospital' ? (p) => p.sub === 'ed' : null, kind !== 'hospital');
      out.station = st[0] || null;
    }
    return out;
  }

  /**
   * Where one more station would bring the most people within `threshold` seconds of a 911 call.
   * Tries a grid of main-road spots across the county. Returns the best few.
   */
  bestNewStation(kind = 'fire', threshold = 480, tries = 260) {
    const em = this.app.world.emergency;
    const net = this.net;
    const b = this.data.buildings;
    const base = em.responseTimes(kind, { live: false, extra: [] });
    const w = em.emergencyWeights ? em.emergencyWeights(false) : net.ffTime;
    const t0 = 60 + ({ fire: 80, ems: 60, police: 30, medical: 80 }[kind] ?? 60);
    // Residents not reached in time today, by road node.
    const need = new Float32Array(net.nodeCount);
    let unserved = 0; let total = 0;
    for (let i = 0; i < b.count; i++) {
      const r = b.residents[i];
      if (!r) continue;
      total += r;
      // Same allowance from the road to the door as the coverage numbers use.
      if (base[b.node[i]] + this.app.accessSeconds(i) * 0.5 > threshold) { need[b.node[i]] += r; unserved += r; }
    }
    // Candidate sites: the busiest unserved spots on a coarse grid, snapped to a through road.
    const G = 1500;
    const cells = new Map();
    for (let n = 0; n < net.nodeCount; n++) {
      if (!need[n]) continue;
      const key = `${Math.floor(net.nodeX[n] / G)},${Math.floor(net.nodeZ[n] / G)}`;
      const c = cells.get(key) || { x: 0, z: 0, w: 0 };
      c.x += net.nodeX[n] * need[n]; c.z += net.nodeZ[n] * need[n]; c.w += need[n];
      cells.set(key, c);
    }
    const cand = [...cells.values()].sort((a, c) => c.w - a.w).slice(0, tries)
      .map((c) => net.nearestNode(c.x / c.w, c.z / c.w, (i) => net.nodeRank[i] >= 2)).filter((n) => n >= 0);
    const buf = new Float32Array(net.nodeCount);
    const results = [];
    const seen = new Set();
    for (const node of cand) {
      if (seen.has(node)) continue;
      seen.add(node);
      this.app.router.dijkstra([{ node, t0 }], w, { out: buf, maxTime: threshold });
      let gain = 0;
      for (let n = 0; n < net.nodeCount; n++) if (need[n] && buf[n] <= threshold) gain += need[n];
      results.push({ node, x: net.nodeX[node], z: net.nodeZ[node], gain });
    }
    results.sort((a, c) => c.gain - a.gain);
    const top = [];
    for (const r of results) {
      if (top.every((t) => Math.hypot(t.x - r.x, t.z - r.z) > 3000)) top.push(r);
      if (top.length >= 3) break;
    }
    for (const r of top) r.where = this.gaz.describe(r.x, r.z);
    return { kind, threshold, total, unserved, covered: total - unserved, top, tried: results.length };
  }

  /** Roads slowest against free flow in the live simulation right now (named roads, by length slowed). */
  slowRoads(n = 5) {
    const net = this.net;
    const c = this.app.world.congestion;
    const agg = new Map();
    for (let e = 0; e < net.edgeCount; e++) {
      const nm = net.names[net.nameId[e]];
      if (!nm || net.len[e] < 30 || net.cls[e] > 5) continue;
      const a = agg.get(nm) || { name: nm, len: 0, slow: 0, delay: 0, x: 0, z: 0, w: 0 };
      const d = net.ffTime[e] * (c[e] - 1);
      a.len += net.len[e];
      a.delay += d;
      if (c[e] > 1.3) {
        a.slow += net.len[e];
        a.x += net.nodeX[net.from[e]] * d; a.z += net.nodeZ[net.from[e]] * d; a.w += d;
      }
      agg.set(nm, a);
    }
    const rows = [...agg.values()].filter((a) => a.slow > 400 && a.w > 0).map((a) => ({
      name: a.name.replace(/ \(.*\)$/, ''), full: a.name, miles: a.slow / MI, ratio: 1 + a.delay / (a.len / 15), delayMin: a.delay / 60,
      x: a.x / a.w, z: a.z / a.w,
    }));
    rows.sort((a, c2) => c2.delayMin - a.delayMin);
    const out = [];
    for (const r of rows) {
      if (out.every((o) => o.name !== r.name)) out.push(r);
      if (out.length >= n) break;
    }
    return out;
  }

  /**
   * How slow a named road is: average speed against its no-traffic speed.
   * basis 'live' (the simulation right now), or 'am' / 'pm' (a typical school day at 8 a.m. / 5:30 p.m.).
   */
  roadNow(ent, basis = 'live') {
    const net = this.net;
    let c = this.app.world.congestion;
    if (basis === 'am' || basis === 'pm') {
      const w = this.app.weights(basis);
      c = new Float32Array(net.edgeCount);
      for (const e of ent.edges) c[e] = w[e] / net.ffTime[e];
    }
    let ff = 0; let now = 0; let len = 0; let worst = null;
    for (const e of ent.edges) {
      ff += net.ffTime[e]; now += net.ffTime[e] * c[e]; len += net.len[e];
      if (worst === null || c[e] > c[worst]) worst = e;
    }
    return { miles: len / MI / 2, ffMph: (len / ff) * 2.23694, nowMph: (len / now) * 2.23694, ratio: now / ff, worst, worstRatio: c[worst],
      worstX: net.nodeX[net.from[worst]], worstZ: net.nodeZ[net.from[worst]] };
  }

  elevationFt(x, z) {
    return this.app.heightAt(x, z) * 3.28084;
  }

  /** Highest and lowest ground inside the county, from the terrain grid. */
  extremes() {
    if (this._ext) return this._ext;
    const t = this.data.terrain;
    let hi = { h: -Infinity }; let lo = { h: Infinity };
    const step = 1;
    for (let r = 0; r < t.nz; r += step) {
      for (let c = 0; c < t.nx; c += step) {
        const x = t.x0 + c * t.cell;
        const z = t.z0 + r * t.cell;
        if (this.app.overlays.areaAt(x, z).block < 0) continue;
        const h = t.height[r * t.nx + c];
        if (h > hi.h) hi = { h, x, z };
        if (h < lo.h) lo = { h, x, z };
      }
    }
    this._ext = { hi, lo };
    return this._ext;
  }

  /** Zoned public schools at a point (county attendance districts). */
  zoned(x, z) {
    const blk = this.app.overlays.areaAt(x, z).block;
    let out = blk >= 0 ? this.app.zonedSchools(blk) : [];
    if (out.length) return out;
    // A label can sit on a shopping center or a park, where no students live. Use the closest home.
    const b = this.data.buildings;
    let best = -1; let bd = Infinity;
    b.forEachNear(x, z, 1500, (i) => {
      if (!b.residents[i] || b.block[i] < 0) return;
      const d = Math.hypot(b.x[i] - x, b.z[i] - z);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) out = this.app.zonedSchools(b.block[best]);
    return out;
  }

  /** County-wide tallies used in several answers. */
  totals() {
    if (this._tot) return this._tot;
    const b = this.data.buildings;
    const net = this.net;
    let homes = 0; let jobs = 0; let km = 0;
    for (let i = 0; i < b.count; i++) { homes += b.units[i]; jobs += b.jobs[i]; }
    for (let e = 0; e < net.edgeCount; e++) if (net.dir[e] > 0 || net.twin[e] < 0) km += net.len[e] / 1000;
    const blk = this.areas.block;
    this._tot = {
      buildings: b.count, homes: blk.units.reduce((a, c) => a + c, 0), modelHomes: homes, jobs, roadMiles: km * 0.621371,
      pop2020: blk.pop.reduce((a, c) => a + c, 0), signals: net.nodeSignal ? net.nodeSignal.reduce((a, c) => a + (c ? 1 : 0), 0) : 0,
    };
    return this._tot;
  }

  // --- A place of the student's own ---------------------------------------------------------------------

  setMySpot(spot) {
    this.mySpot = spot ? { type: 'spot', name: 'my spot', ...spot, node: spot.node ?? this.net.nearestNode(spot.x, spot.z, (i) => this.net.nodeRank[i] >= 1) } : null;
    try {
      if (spot) localStorage.setItem('ask-asheville:spot', JSON.stringify({ x: spot.x, z: spot.z, label: spot.label || '' }));
      else localStorage.removeItem('ask-asheville:spot');
    } catch { /* optional */ }
    return this.mySpot;
  }

  restoreMySpot() {
    try {
      const s = JSON.parse(localStorage.getItem('ask-asheville:spot') || 'null');
      if (s && Number.isFinite(s.x)) this.setMySpot(s);
    } catch { /* optional */ }
  }

  /** An entity for any ground point. */
  pointEntity(x, z, name = 'that spot') {
    return { type: 'point', name, x, z, node: this.net.nearestNode(x, z, (i) => this.net.nodeRank[i] >= 1), radius: 800 };
  }

  /** The thing currently selected on the map, as an entity. */
  selectionEntity() {
    const s = this.app.selection;
    if (!s) return null;
    if (s.kind === 'poi') return this.gaz.fromPoi(s.poi);
    if (s.kind === 'building') {
      const b = this.data.buildings;
      return { type: 'point', name: 'the selected building', x: b.x[s.building], z: b.z[s.building], node: b.node[s.building], radius: 800 };
    }
    if (s.kind === 'ground' || s.kind === 'road') return this.pointEntity(s.x, s.z, 'the selected spot');
    return null;
  }
}

export { MI };

// Ties the simulation together: the road network, signals, traffic, the day's trips, 911
// response, the clock and the weather. Rendering-free, so it also runs under Node for the
// tests and the headless calibration runs.
//
// Time: `world.time` is monotonic simulated seconds since the world started (signals and
// incidents use it); `world.clock` is the Asheville calendar date and time of day. Simulated
// seconds advance at `speed` per real second, within a per-frame compute budget so the page
// stays smooth; when the budget runs out the clock simply runs slower than asked.

import { RNG } from '../core/rng.js';
import { Router } from './router.js';
import { Signals } from './signals.js';
import { Traffic } from './traffic.js';
import { TripMaker } from './demand.js';
import { Emergency } from './emergency.js';
import { Clock, litShare } from './clock.js';
import { Weather } from './weather.js';
import { SCENARIOS, EVENT_CATALOG, resolveScenario } from './scenarios.js';
import { loadBundle } from '../data/bundle.js';
import { SIM_DT, clamp } from './constants.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const EMIT_AHEAD = 120; // s of trips generated ahead of the clock
const ROUTE_AHEAD = 45; // s ahead of departure a trip gets its route
const GIVE_UP_SPAWN = 900; // s a trip may wait for room to enter the road

/** Binary min-heap of trips by absolute departure time. */
class TripHeap {
  constructor() {
    this.a = [];
  }

  get size() {
    return this.a.length;
  }

  peek() {
    return this.a[0];
  }

  push(t) {
    const a = this.a;
    a.push(t);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].tAbs <= t.tAbs) break;
      a[i] = a[p];
      i = p;
    }
    a[i] = t;
  }

  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      let i = 0;
      const n = a.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && a[c + 1].tAbs < a[c].tAbs) c++;
        if (a[c].tAbs >= last.tAbs) break;
        a[i] = a[c];
        i = c;
      }
      a[i] = last;
    }
    return top;
  }

  clear() {
    this.a.length = 0;
  }
}

export class World {
  /**
   * @param {object} data from loadWorldData()
   * @param {object} [o]
   * @param {number} [o.seed]
   * @param {string|object} [o.scenario] scenario id or object (see scenarios.js)
   * @param {number} [o.demand] traffic demand multiplier
   * @param {number} [o.sample] share of trips simulated as vehicles (capacity scaled to match)
   * @param {number} [o.startHour] overrides the scenario's start time
   * @param {number} [o.budgetMs] compute budget per frame (Infinity under Node)
   * @param {number} [o.workers] routing workers in the browser (0 = route on the main thread)
   */
  constructor(data, { seed = 2026, scenario = 'weekday', demand = 1, sample = 1, startHour = null, budgetMs = null, landmarks = 12, workers = null } = {}) {
    this.data = data;
    this.net = data.roads;
    this.seed = seed;
    this.rng = new RNG(seed);
    this.router = new Router(this.net);
    this.router.prepareLandmarks(landmarks);
    this.signals = new Signals(this.net, this.rng.fork('signals'));
    this.traffic = new Traffic(this.net, this.signals, this.rng.fork('traffic'));
    this.clock = new Clock();
    this.weather = new Weather(this.rng.fork('weather'), 'clear');
    this.demandMaker = new TripMaker(this);
    this.emergency = new Emergency(this);
    this.scenarios = SCENARIOS;
    this.eventCatalog = EVENT_CATALOG;
    this.demand = demand;
    this.sample = clamp(sample, 0.05, 1);
    this.traffic.setSample(this.sample);
    this.budgetMs = budgetMs ?? (typeof window === 'undefined' ? Infinity : 12);
    this.routeBudgetMs = this.budgetMs === Infinity ? Infinity : 5;
    this.routeSpent = 0;
    this.frameStart = now();
    this.time = 0;
    this.acc = 0;
    this.future = new TripHeap();
    this.toSpawn = [];
    this.live = new Float32Array(this.net.edgeCount);
    this.routeW = new Float32Array(this.net.edgeCount);
    this.liveAt = -1;
    this.typical = {};
    this.typicalLoading = {};
    this.actualSpeed = 0;
    this.stepsLastFrame = 0;
    this.counters = { emitted: 0, routed: 0, spawned: 0, droppedNoRoute: 0, droppedNoRoom: 0, late: 0 };
    this.history = new Array(144).fill(null);
    this.historyDay = null;
    this._decayAt = 0;
    this._statAt = 0;
    // Browser: route trips on a pool of workers; Node: route synchronously.
    this.sampleTarget = this.sample;
    this.autoSample = typeof window !== 'undefined';
    this.autoState = { low: 0, high: 0, acc: 0, cool: 0, note: '' };
    this.requestedSpeed = 1;
    this.workers = [];
    this.pendingRoutes = new Map();
    this.nextReq = 1;
    this.weightsPostedAt = -1e9;
    if (typeof window !== 'undefined' && typeof Worker !== 'undefined' && workers !== 0) {
      const n = workers ?? Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 2));
      try {
        this.startWorkers(n);
      } catch (err) {
        console.warn('Routing workers unavailable; routing on the main thread.', err);
        this.workers = [];
      }
    }
    this.traffic.onArrive = (v, t) => this.onArrive(v, t);
    this.traffic.needReroute = (v) => this.rerouteBlocked(v);
    this.clock.onDayChange = null;
    this.setScenario(scenario, { startHour });
  }

  // --- Public API -------------------------------------------------------------------------

  get vehicles() {
    return this.traffic.vehicles;
  }

  get congestion() {
    return this.traffic.congestion;
  }

  get simTime() {
    return this.time;
  }

  get events() {
    return this.scenario.events;
  }

  pose(v, out) {
    return this.traffic.pose(v, out);
  }

  /** Inspector text for a vehicle: {status, road, heading, speedLimitMph, remainingM}. */
  describe(v) {
    return this.traffic.describe(v);
  }

  /** Share of windows lit now, by building use: [office, residential, retail, industrial, civic]. */
  litShares() {
    const h = this.clock.hour;
    return [0, 1, 2, 3, 4].map((u) => litShare(u, h));
  }

  /**
   * Call after moving the clock by hand (the time slider). Re-seeks today's trips to the new
   * time. A jump of more than ten minutes clears the roads, which then fill again naturally.
   */
  onClockJump() {
    const t = this.clock.t;
    const prevDay0 = this.dayStart;
    const prevT = this.time - prevDay0;
    const jump = t - prevT;
    if (Math.abs(jump) > 600) this.clearTraffic();
    this.dayStart = this.time - t;
    // Trips already queued keep their clock time relative to the new day start.
    const shift = this.dayStart - prevDay0;
    if (shift !== 0) {
      for (const trip of this.future.a) {
        trip.tAbs += shift;
        trip.day0 = (trip.day0 ?? prevDay0) + shift;
      }
      for (const trip of this.toSpawn) {
        trip.tAbs += shift;
        trip.day0 = (trip.day0 ?? prevDay0) + shift;
      }
      for (const trip of this.pendingRoutes.values()) {
        trip.tAbs += shift;
        trip.day0 = (trip.day0 ?? prevDay0) + shift;
      }
      // A uniform shift keeps the heap ordered.
    }
    this.emitT = Math.max(0, t - 60);
    const q = this.demandMaker.queue;
    let lo = 0;
    let hi = q.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (q[mid].tDep < this.emitT) lo = mid + 1;
      else hi = mid;
    }
    this.demandMaker.cursor = lo;
    this.liveAt = -1;
    this._statAt = this.time;
  }

  /**
   * Switch scenario: resets traffic, sets the date, time and weather, builds the day's trips.
   * @param {string|object} id
   * @param {{startHour?: number}} [o]
   */
  setScenario(id, { startHour = null, warmupMinutes = 0 } = {}) {
    const sc = resolveScenario(id);
    this.scenario = sc;
    this.clearTraffic();
    this.clock.onDayChange = null;
    this.clock.setDate(sc.date);
    // Start early by `warmupMinutes`; the caller then runs warmup() to reach the start time
    // with traffic already on the roads.
    this.clock.setHour(Math.max(0, (startHour ?? sc.startHour ?? 6.5) - warmupMinutes / 60));
    this.warmupMinutes = warmupMinutes;
    this.clock.onDayChange = () => this.newDay();
    this.weather.setMode(sc.weather || 'auto');
    const k = this.weather.kind;
    this.weather.cloud = { clear: 0.16, cloudy: 0.72, rain: 0.9, storm: 1, fog: 0.4, snow: 0.95 }[k] ?? this.weather.cloud;
    this.weather.snow = k === 'snow' ? 1 : 0;
    this.weather.rain = k === 'rain' ? 0.6 : k === 'storm' ? 1 : 0;
    this.weather.wet = k === 'snow' || k === 'rain' || k === 'storm' ? 1 : 0;
    this.weather.snowCover = k === 'snow' ? 1 : 0;
    this.startDay(true);
  }

  setDemand(f) {
    this.demand = clamp(f, 0.05, 3);
  }

  setSample(f) {
    this.sample = clamp(f, 0.05, 1);
    this.sampleTarget = this.sample;
    this.traffic.setSample(this.sample);
  }

  // --- Routing workers ------------------------------------------------------------------------

  startWorkers(n) {
    const net = this.net;
    const lm = this.router.landmarks;
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../worker/route-worker.js', import.meta.url), { type: 'module' });
      const entry = { worker: w, ready: false, inflight: 0 };
      w.onmessage = (ev) => this.onWorkerMessage(entry, ev.data);
      w.onerror = (err) => {
        console.warn('Routing worker failed; falling back to the main thread.', err.message || err);
        this.workers = this.workers.filter((x) => x !== entry);
        this.requeuePending();
      };
      w.postMessage({
        type: 'init', nodeCount: net.nodeCount, outStart: net.outStart, outEdges: net.outEdges, inStart: net.inStart, inEdges: net.inEdges,
        from: net.from, to: net.to, len: net.len, nodeX: net.nodeX, nodeZ: net.nodeZ, maxSpeed: net.maxSpeed,
        lmCount: lm.count, lmFrom: lm.lmFrom, lmTo: lm.lmTo, weights: new Float32Array(net.ffTime),
      });
      this.workers.push(entry);
    }
  }

  onWorkerMessage(entry, m) {
    if (m.type === 'ready') {
      entry.ready = true;
      return;
    }
    if (m.type !== 'routes') return;
    entry.inflight -= m.ids.length;
    const ff = this.net.ffTime;
    for (let i = 0; i < m.ids.length; i++) {
      const trip = this.pendingRoutes.get(m.ids[i]);
      if (!trip) continue; // from before a reset
      this.pendingRoutes.delete(m.ids[i]);
      if (m.times[i] < 0) {
        this.counters.droppedNoRoute++;
        continue;
      }
      const edges = m.edges.slice(m.offsets[i], m.offsets[i + 1]);
      let t = 0;
      for (let k = 0; k < edges.length; k++) t += ff[edges[k]];
      trip.route = edges;
      trip.ff = t;
      this.counters.routed++;
      this.toSpawn.push(trip);
    }
  }

  /** Trips waiting on a worker go back to the queue (after a worker failure or reset). */
  requeuePending() {
    for (const trip of this.pendingRoutes.values()) this.future.push(trip);
    this.pendingRoutes.clear();
  }

  postWeights() {
    const live = this.routingWeights();
    for (const w of this.workers) w.worker.postMessage({ type: 'weights', weights: new Float32Array(live) });
    this.weightsPostedAt = this.time;
  }

  /**
   * Trips that should no longer happen: thinned by load shedding, invalid, or for an event that
   * was switched off or rescheduled (people already there still go home).
   */
  tripStale(trip) {
    if (trip.skip) return true;
    if (trip.o == null || trip.d == null || trip.o < 0 || trip.d < 0 || trip.o === trip.d) return true;
    if (trip.event && !trip.eventReturn) {
      const ev = this.scenario.events.find((e) => e.id === trip.event);
      if (ev && (!ev.active || (ev.version || 0) !== (trip.eventVersion || 0))) return true;
    }
    return false;
  }

  /** Send trips that leave soon to the workers in batches. */
  dispatchRoutes(horizon) {
    const ready = this.workers.filter((w) => w.ready);
    if (!ready.length) return false;
    if (this.time - this.weightsPostedAt >= 15) this.postWeights();
    const MAX_INFLIGHT = 6000;
    const batch = [];
    while (this.future.size && this.future.peek().tAbs <= horizon && this.pendingRoutes.size + batch.length < MAX_INFLIGHT) {
      const trip = this.future.pop();
      if (this.tripStale(trip)) continue;
      batch.push(trip);
    }
    if (!batch.length) return true;
    const CHUNK = 192;
    for (let start = 0; start < batch.length; start += CHUNK) {
      const part = batch.slice(start, start + CHUNK);
      const ids = new Int32Array(part.length);
      const o = new Int32Array(part.length);
      const d = new Int32Array(part.length);
      part.forEach((trip, i) => {
        const id = this.nextReq++;
        ids[i] = id;
        o[i] = trip.o;
        d[i] = trip.d;
        this.pendingRoutes.set(id, trip);
      });
      // Least-busy worker.
      let wk = ready[0];
      for (const w of ready) if (w.inflight < wk.inflight) wk = w;
      wk.inflight += part.length;
      wk.worker.postMessage({ type: 'route', ids, o, d }, [ids.buffer, o.buffer, d.buffer]);
    }
    return true;
  }

  // --- Keeping up ---------------------------------------------------------------------------------

  /**
   * When the simulation can't keep up with the requested clock speed (or trips pile up waiting
   * for routes), simulate a smaller share of trips; give it back when things are calm.
   */
  manageLoad(realDt) {
    if (!this.autoSample) return;
    const a = this.autoState;
    a.acc += realDt;
    if (a.acc < 1) return;
    a.acc = 0;
    const want = Math.min(this.requestedSpeed, 600);
    const overdue = this.overdueCount();
    // Too slow for the requested clock speed: shed load, but only down to 35% for speed alone
    // (very high speeds are simply not reachable); a routing backlog can push it lower.
    const slow = want >= 30 && this.actualSpeed < want * 0.45 && this.sample > 0.35;
    const backlog = overdue > 2500;
    const calm = overdue < 300 && this.actualSpeed >= want * 0.85;
    a.low = slow || backlog ? a.low + 1 : 0;
    a.high = calm ? a.high + 1 : 0;
    if (a.cool > 0) a.cool--;
    if (a.low >= 3 && a.cool === 0 && this.sample > 0.11) {
      const next = Math.max(backlog ? 0.1 : 0.35, this.sample * 0.8);
      a.cool = 8; // let the roads adjust before cutting again
      const keep = next / this.sample;
      // Thin the trips already waiting so the backlog clears.
      for (const t of this.future.a) if (t.tAbs < this.time + 60 && this.rng.next() > keep) t.skip = true;
      this.toSpawn = this.toSpawn.filter(() => this.rng.next() <= keep);
      this.sample = next;
      this.traffic.setSample(next);
      a.low = 0;
      a.note = `Simulating ${Math.round(next * 100)}% of trips to keep up`;
    } else if (a.high >= 15 && this.sample < this.sampleTarget) {
      this.sample = Math.min(this.sampleTarget, this.sample * 1.12);
      this.traffic.setSample(this.sample);
      a.high = 0;
      a.note = this.sample >= this.sampleTarget ? '' : `Simulating ${Math.round(this.sample * 100)}% of trips`;
    }
  }

  /** Switch an event on or off (or change its attendance/time) for the current day. */
  setEvent(id, patch = {}) {
    const ev = this.scenario.events.find((e) => e.id === id);
    if (!ev) return null;
    const wasActive = ev.active;
    Object.assign(ev, patch);
    if (ev.active && (!wasActive || patch.attendance != null || patch.start != null)) {
      // Schedule the event's remaining trips into today.
      ev.version = (ev.version || 0) + 1;
      const day0 = this.dayStart;
      const tNow = this.clock.t;
      this.demandMaker.scheduleEvent(ev, (t, trip) => {
        if (t < tNow) return;
        trip.tDep = t;
        trip.eventVersion = ev.version;
        this.pushTrip(trip, day0, 1);
      }, 1);
    }
    return ev;
  }

  /** Live drive-time weights: ORS free-flow times scaled by measured congestion. */
  liveWeights() {
    if (this.liveAt !== this.time) {
      const ff = this.net.ffTime;
      const c = this.traffic.congestion;
      const delay = this.traffic.ctrlDelay;
      const cls = this.net.cls;
      const w = this.live;
      const rw = this.routeW;
      for (let e = 0; e < w.length; e++) {
        w[e] = ff[e] * c[e];
        // Simulated drivers react to congestion but don't abandon the main roads wholesale:
        // routing sees at most three times free flow, and parking lots, rest areas and service
        // drives count as slower. They also expect the usual wait at signals and stop signs,
        // which the congestion ratio leaves out (drive-time numbers use the live weights).
        const r = ff[e] * (c[e] < 3 ? c[e] : 3);
        rw[e] = (cls[e] === 13 ? r * 2.5 : r) + delay[e];
      }
      this.liveAt = this.time;
    }
    return this.live;
  }

  /** Weights simulated drivers route by (live weights with service roads discouraged). */
  routingWeights() {
    this.liveWeights();
    return this.routeW;
  }

  /**
   * Typical drive-time weights for an hour of a day type, from a recorded simulated day
   * (data/typical_<kind>.bin.gz). Falls back to free flow until loaded.
   */
  typicalWeights(hour, kind = 'weekday') {
    const t = this.typical[kind];
    if (!t) {
      this.loadTypical(kind);
      return this.net.ffTime;
    }
    const E = this.net.edgeCount;
    const h = ((hour % 24) + 24) % 24;
    const h0 = Math.floor(h);
    const h1 = (h0 + 1) % 24;
    const f = h - h0;
    const key = `${kind}:${Math.round(h * 4)}`;
    if (t.cacheKey === key) return t.cache;
    const q = t.q;
    const s = t.scale;
    const ff = this.net.ffTime;
    const out = t.cache || new Float32Array(E);
    for (let e = 0; e < E; e++) {
      const r0 = 1 + q[h0 * E + e] / s;
      const r1 = 1 + q[h1 * E + e] / s;
      out[e] = ff[e] * (r0 + (r1 - r0) * f);
    }
    t.cache = out;
    t.cacheKey = key;
    return out;
  }

  async loadTypical(kind = 'weekday') {
    if (this.typical[kind]) return this.typical[kind];
    if (!this.typicalLoading[kind]) {
      const base = this.data.base || './data/';
      this.typicalLoading[kind] = loadBundle(`${base}typical_${kind}.bin.gz`).then((b) => {
        if (b.arrays.ratio_q.length !== 24 * this.net.edgeCount) throw new Error('typical profile does not match the road network');
        this.typical[kind] = { q: b.arrays.ratio_q, scale: b.meta.scale || 40, meta: b.meta, cache: null, cacheKey: null };
        return this.typical[kind];
      }).catch(() => {
        this.typical[kind] = null;
        return null;
      });
    }
    return this.typicalLoading[kind];
  }

  /** Free-flow, live or typical drive time (s) between two nodes. */
  travelTime(fromNode, toNode, mode = 'free', hour = 8) {
    const w = mode === 'live' ? this.liveWeights() : mode === 'typical' ? this.typicalWeights(hour) : this.net.ffTime;
    const r = this.router.routeALT(fromNode, toNode, w);
    return r ? r.time : Infinity;
  }

  /** Seconds from every node to `node` (reverse Dijkstra) under a weighting mode. */
  timesTo(node, mode = 'free', hour = 8, out = null) {
    const w = mode === 'live' ? this.liveWeights() : mode === 'typical' ? this.typicalWeights(hour) : this.net.ffTime;
    return this.router.dijkstra([node], w, { reverse: true, out });
  }

  stats() {
    const t = this.traffic.stats();
    return {
      ...t,
      completedToday: t.completed,
      sample: this.sample,
      sampleTarget: this.sampleTarget,
      loadNote: this.autoState?.note || '',
      routing: this.pendingRoutes ? this.pendingRoutes.size : 0,
      backlog: this.future.size,
      overdue: this.overdueCount(),
      waitingToEnter: this.toSpawn.length,
      actualSpeed: this.actualSpeed,
      dayType: this.clock.dayType,
      demandSummary: this.demandMaker.summary,
      ...this.counters,
    };
  }

  /** Trips whose departure time has passed but which are not on the road yet. */
  overdueCount() {
    let n = this.toSpawn.length;
    // The heap is only partially ordered; count from the top until departures are in the future.
    const a = this.future.a;
    for (let i = 0; i < a.length && i < 5000; i++) if (a[i].tAbs < this.time) n++;
    return n;
  }

  /** Expected vehicles on the road at an hour (the HUD's planned-demand curve). */
  expectedActive(hour) {
    return this.demandMaker.expectedActive(hour);
  }

  /**
   * Run the simulation forward without rendering (e.g. to fill the roads before showing them).
   * Yields to the event loop between chunks; `onProgress(fraction)` is called along the way.
   */
  async warmup(minutes = 30, onProgress = null, chunkMs = 40) {
    const target = this.time + minutes * 60;
    const startT = this.time;
    while (this.time < target) {
      const t0 = now();
      while (this.time < target && now() - t0 < chunkMs) this.tick(SIM_DT, 1 / 60);
      if (onProgress) onProgress((this.time - startT) / (target - startT));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  // --- Stepping ------------------------------------------------------------------------------

  /**
   * Advance by `realDt` seconds of wall time at `speed` simulated seconds per real second.
   * Returns the number of simulation steps taken.
   */
  step(realDt, speed) {
    const frameStart = now();
    this.frameStart = frameStart;
    this.routeSpent = 0;
    this.requestedSpeed = speed;
    this.manageLoad(Math.min(realDt, 0.1));
    const want = Math.min(realDt, 0.1) * speed;
    this.acc += want;
    const dt = speed > 240 ? 1.0 : SIM_DT;
    let steps = 0;
    while (this.acc >= dt) {
      this.tick(dt, realDt / Math.max(1, (want / dt)));
      this.acc -= dt;
      steps++;
      if (now() - frameStart > this.budgetMs) {
        if (this.acc > dt * 2) this.acc = dt * 2; // drop what we can't afford this frame
        break;
      }
    }
    this.stepsLastFrame = steps;
    const simAdvanced = steps * dt;
    const rate = realDt > 0 ? simAdvanced / Math.min(realDt, 0.1) : 0;
    this.actualSpeed += (rate - this.actualSpeed) * 0.1;
    if (want === 0) this.weather.update(0, Math.min(realDt, 0.1));
    return steps;
  }

  tick(dt, realDt = 0) {
    this.time += dt;
    this.clock.advance(dt);
    this.weather.update(dt, realDt);
    this.traffic.speedFactor = this.weather.speedFactor();
    this.emitTrips();
    this.routeAndSpawn();
    this.traffic.step(dt, this.time);
    this.emergency.update(dt, this.time);
    if (this.time - this._decayAt >= 30) {
      this.traffic.decay(this.time, this.time - this._decayAt);
      this._decayAt = this.time;
    }
    if (this.time - this._statAt >= 60) {
      this._statAt = this.time;
      this.recordHistory();
    }
  }

  // --- Days, trips, routing ------------------------------------------------------------------

  clearTraffic() {
    const tr = this.traffic;
    for (const v of tr.vehicles) v.dead = true;
    tr.vehicles.length = 0;
    for (let i = 0; i < tr.laneCars.length; i++) if (tr.laneCars[i]) tr.laneCars[i].length = 0;
    tr.laneOn.fill(0);
    tr.active.length = 0;
    tr.ema.fill(1);
    tr.congestion.fill(1);
    tr.lastObs.fill(-1e9);
    tr.flowCount.fill(0);
    tr.nodeBusyUntil.fill(0);
    tr.claim.fill(null);
    tr.stat = { completed: 0, sumTrip: 0, sumFF: 0, lifted: 0, rerouted: 0, recentActual: 0, recentFF: 0 };
    this.future.clear();
    this.toSpawn.length = 0;
    this.pendingRoutes?.clear();
    this.emergency.incidents.length = 0;
    this.emergency.patrols.length = 0;
    for (const st of this.emergency.stations) for (const u of st.units) u.busy = false;
    this.liveAt = -1;
    this.history = new Array(144).fill(null);
  }

  /** Scenario for the current calendar day (the preset itself, or a plain day after midnight). */
  scenarioForToday() {
    const sc = this.scenario;
    if (this.clock.iso === sc.date) return sc;
    const dayType = this.clock.dayType;
    return { id: `${dayType}-auto`, date: this.clock.iso, dayType, mult: {}, events: [], school: undefined };
  }

  startDay(fromScenario = false) {
    const sc = fromScenario ? this.scenario : this.scenarioForToday();
    this.dayStart = this.time - this.clock.t;
    // Trips are generated at demand 1; pushTrip() applies the slider and sampling.
    this.demandMaker.startDay(this.clock, sc, 1);
    // Skip what departed long before now (scenario starting mid-day).
    this.emitT = Math.max(0, this.clock.t - 60);
    this.demandMaker.cursor = 0;
    const q = this.demandMaker.queue;
    while (this.demandMaker.cursor < q.length && q[this.demandMaker.cursor].tDep < this.emitT) this.demandMaker.cursor++;
    this.historyDay = this.clock.iso;
  }

  newDay() {
    this.startDay(false);
    this.emitT = 0;
    this.demandMaker.cursor = 0;
    this.history = new Array(144).fill(null);
    this.traffic.stat.completed = 0;
    this.traffic.stat.sumTrip = 0;
    this.traffic.stat.sumFF = 0;
  }

  /** Queue a trip whose tDep is seconds after `day0` (absolute day start). */
  pushTrip(trip, day0 = this.dayStart, schedDemand = 1) {
    // Sampling and the demand slider decide whether (and how often) this trip happens.
    let keep = this.sample * (this.demand / (schedDemand || 1));
    while (keep > 0) {
      if (keep >= 1 || this.rng.next() < keep) {
        const t = keep >= 1 && keep < 2 ? trip : { ...trip };
        t.tAbs = day0 + t.tDep;
        t.day0 = day0;
        this.future.push(t);
        this.counters.emitted++;
      }
      keep -= 1;
    }
  }

  emitTrips() {
    const target = Math.min(86400, this.clock.t + EMIT_AHEAD);
    if (target <= this.emitT) return;
    const day0 = this.dayStart;
    // Streaming rates are generated at demand 1 and scaled here like scheduled trips.
    this.demandMaker.emit(this.emitT, target, (trip) => this.pushTrip(trip, day0, 1));
    this.emitT = target;
  }

  routeAndSpawn() {
    const tr = this.traffic;
    const limited = this.routeBudgetMs !== Infinity;
    const live = this.routingWeights();
    const horizon = this.time + ROUTE_AHEAD;
    const viaWorkers = this.workers.length > 0 && this.dispatchRoutes(horizon + (this.requestedSpeed > 60 ? ROUTE_AHEAD : 0));
    // Route trips that leave soon, within this frame's routing budget.
    while (!viaWorkers && this.future.size && this.future.peek().tAbs <= horizon) {
      if (limited && (this.routeSpent >= this.routeBudgetMs || now() - this.frameStart > this.budgetMs * 0.7)) break;
      const r0 = limited ? now() : 0;
      const trip = this.future.pop();
      if (this.tripStale(trip)) continue;
      const r = this.router.routeALT(trip.o, trip.d, live);
      if (!r || !r.edges.length) {
        this.counters.droppedNoRoute++;
        continue;
      }
      if (limited) this.routeSpent += now() - r0;
      trip.route = r.edges;
      let ff = 0;
      for (let i = 0; i < r.edges.length; i++) ff += this.net.ffTime[r.edges[i]];
      trip.ff = ff;
      this.counters.routed++;
      this.toSpawn.push(trip);
    }
    // Put due trips on the road.
    if (!this.toSpawn.length) return;
    let w = 0;
    for (let i = 0; i < this.toSpawn.length; i++) {
      const trip = this.toSpawn[i];
      if (trip.tAbs > this.time || (trip.nextTry && trip.nextTry > this.time)) {
        this.toSpawn[w++] = trip;
        continue;
      }
      const v = tr.spawn(trip, this.time);
      if (v) {
        v.departedClock = this.clock.t; // seconds since midnight; v.departed is world.time
        this.counters.spawned++;
        if (this.time - trip.tAbs > 120) this.counters.late++;
        continue;
      }
      if (this.time - trip.tAbs > GIVE_UP_SPAWN) {
        this.counters.droppedNoRoom++;
        continue;
      }
      trip.nextTry = this.time + 2 + this.rng.next() * 2; // wait for a gap, like a car at a driveway
      this.toSpawn[w++] = trip;
    }
    this.toSpawn.length = w;
  }

  onArrive(v, t) {
    if (v.emUnit) {
      this.emergency.onArrive(v, t);
      return;
    }
    const trip = v.trip;
    if (!trip || !trip.after) return;
    const a = trip.after;
    const next = { ...a.next };
    const at = a.atTime != null ? trip.day0 + a.atTime : -Infinity;
    const tAbs = Math.max(t + (a.dwell ?? 60), at);
    next.tAbs = tAbs;
    next.tDep = tAbs - trip.day0;
    next.day0 = trip.day0;
    if (next.from == null) next.from = trip.to ?? -1;
    if (next.to == null) next.to = trip.from ?? -1;
    if (next.type == null) next.type = v.type;
    next.color = v.color;
    next.event = trip.event;
    next.eventVersion = trip.eventVersion;
    next.eventReturn = !!trip.event;
    this.future.push(next);
  }

  /** A car stuck behind a full road for a while tries another way. */
  rerouteBlocked(v) {
    const net = this.net;
    if (v.ri >= v.route.length - 1) return;
    const blocked = v.route[v.ri + 1];
    const dest = net.to[v.route[v.route.length - 1]];
    const from = net.to[v.edge];
    const w = this.routingWeights();
    const saved = w[blocked];
    w[blocked] = Infinity;
    // Landmark bounds stay valid: closing an edge only makes routes longer.
    const r = this.router.routeALT(from, dest, w);
    w[blocked] = saved;
    if (r && r.edges.length) {
      this.traffic.reroute(v, r.edges);
      this.traffic.stat.rerouted++;
    }
  }

  recordHistory() {
    const slot = Math.min(143, Math.floor(this.clock.t / 600));
    if (this.historyDay !== this.clock.iso) {
      this.historyDay = this.clock.iso;
      this.history = new Array(144).fill(null);
    }
    let n = 0;
    for (const v of this.traffic.vehicles) if (!v.leaving && !v.onScene) n++;
    this.history[slot] = n;
  }
}

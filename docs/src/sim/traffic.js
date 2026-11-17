// Vehicles on the real road network. Each car follows the one ahead in its lane with the
// Intelligent Driver Model (as in Signal City) and drives a route of directed edges. At the
// end of an edge the front car needs permission to cross the junction:
//
//   - a green (or a yellow it can't comfortably stop for) at signalized approaches;
//   - room in its lane on the next edge, so queues spill back instead of blocking the box;
//   - a full stop first at stop signs;
//   - at unsignalized junctions, a gap in higher-priority traffic: minor roads yield to major
//     ones, ramps merge into gaps on the freeway, entering traffic yields at roundabouts.
//
// Long waits escalate (assert priority, then re-route, then as a last resort the car is
// lifted out) so the network never locks up. Emergency vehicles with sirens ignore signals
// and yields; cars ahead of them slow and pull toward the curb.
//
// Every edge keeps an exponential moving average of observed traversal time divided by the
// expected uncongested time (posted-speed driving plus the signal's average red wait). That
// ratio is the "congestion" that live drive times multiply onto ORS free-flow times.

import { CTRL, FLAG } from './graph.js';
import { clamp } from './constants.js';

export const VEHICLE_TYPES = {
  sedan: { label: 'Sedan', len: 4.6, wid: 1.85, a: 2.2, b: 3.0, vf: 1.0, weight: 34 },
  hatch: { label: 'Hatchback', len: 4.0, wid: 1.75, a: 2.3, b: 3.0, vf: 1.0, weight: 12 },
  suv: { label: 'SUV or pickup', len: 4.9, wid: 2.0, a: 2.0, b: 3.0, vf: 1.0, weight: 34 },
  van: { label: 'Van', len: 5.4, wid: 2.05, a: 1.7, b: 2.8, vf: 0.95, weight: 8 },
  truck: { label: 'Box truck', len: 7.6, wid: 2.4, a: 1.2, b: 2.5, vf: 0.9, weight: 0 },
  semi: { label: 'Tractor-trailer', len: 16.5, wid: 2.55, a: 0.8, b: 2.2, vf: 0.9, weight: 0 },
  bus: { label: 'Transit bus', len: 11.8, wid: 2.55, a: 1.1, b: 2.4, vf: 0.85, weight: 0 },
  schoolbus: { label: 'School bus', len: 11.0, wid: 2.45, a: 1.0, b: 2.4, vf: 0.82, weight: 0 },
  ambulance: { label: 'Ambulance', len: 6.6, wid: 2.3, a: 2.2, b: 3.5, vf: 1.15, weight: 0 },
  engine: { label: 'Fire engine', len: 10.5, wid: 2.5, a: 1.4, b: 3.2, vf: 1.05, weight: 0 },
  police: { label: 'Police car', len: 5.0, wid: 1.95, a: 2.8, b: 3.5, vf: 1.15, weight: 0 },
};
export const TYPE_NAMES = Object.keys(VEHICLE_TYPES);
const CAR_TYPES = ['sedan', 'hatch', 'suv', 'van'];
const CAR_WEIGHTS = CAR_TYPES.map((t) => VEHICLE_TYPES[t].weight);

const PAINT = [
  ['#f2f2ef', 21], ['#1c1d21', 18], ['#b9bec4', 15], ['#6e737a', 14], ['#23395b', 7], ['#a3262a', 8],
  ['#2e5fa8', 5], ['#2f5d4a', 3], ['#c8b89a', 3], ['#d9822b', 2], ['#3f8f8b', 2], ['#5b2a4e', 2],
];
const FIXED_PAINT = { schoolbus: '#f2b01e', ambulance: '#f4f4f0', engine: '#b3221b', police: '#1d2a44', bus: '#2a6db0' };

export const WAIT = { NONE: 0, RED: 1, CONFLICT: 2, BLOCKED: 3, YIELD: 4, QUEUE: 5, STOP: 6 };
const WAIT_LABEL = ['Moving', 'Waiting at a red light', 'Waiting for the junction to clear', 'Queued: no room ahead',
  'Yielding to traffic', 'In slow traffic', 'Stopping at a stop sign'];

const STOP_OFFSET = 1.2; // virtual obstacle beyond the stop line, so cars stop just short of it
const MIN_GAP = 2.0; // room needed beyond a car's length to enter the next edge
const FADE_TIME = 1.0;
const CRIT_CROSS = 3.5; // s of clearance needed from higher-priority traffic crossing the junction
const CRIT_MERGE = 1.6; // s of clearance needed when merging into the same lane (zipper; the car behind adjusts)
const ESCALATE_YIELD = 30; // s waiting before a car stops yielding
const ESCALATE_BUSY = 60; // s waiting before a car ignores a busy junction
const SQUEEZE_AFTER = 60; // s blocked before a car inches into a gap on real-world spacing
const REROUTE_AFTER = 90; // s blocked before trying another way
const LIFT_AFTER = 240; // s blocked before a car is lifted out to break a gridlock

function removeFrom(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1);
}

/** Keeps `arr` ordered from the front-most vehicle (largest s) to the rear-most. */
function insertSorted(arr, v) {
  let i = arr.length;
  while (i > 0 && arr[i - 1].s < v.s) i--;
  arr.splice(i, 0, v);
}

export class Traffic {
  /**
   * @param {import('./graph.js').RoadNetwork} net
   * @param {import('./signals.js').Signals} signals
   * @param {import('../core/rng.js').RNG} rng
   */
  constructor(net, signals, rng) {
    this.net = net;
    this.signals = signals;
    this.rng = rng;
    const E = net.edgeCount;
    const n = net.nodeCount;
    this.vehicles = [];
    this.nextId = 1;
    this.time = 0;
    this.capScale = 1; // 1 / sample: each simulated vehicle stands for this many real ones
    this.speedFactor = 1; // weather
    this.dt = 0.5;
    this.sirenCount = 0; // vehicles with sirens (set by spawn/emergency code)
    this.reroutesThisStep = 0;

    // Lanes: one ordered array of vehicles per (edge, lane).
    this.laneStart = new Int32Array(E + 1);
    for (let e = 0; e < E; e++) this.laneStart[e + 1] = this.laneStart[e] + Math.max(1, net.lanes[e]);
    const L = this.laneStart[E];
    this.laneCount = L;
    this.laneEdge = new Int32Array(L);
    for (let e = 0; e < E; e++) for (let k = this.laneStart[e]; k < this.laneStart[e + 1]; k++) this.laneEdge[k] = e;
    this.laneCars = new Array(L);
    this.laneOn = new Uint8Array(L);
    this.active = [];
    this.reserved = new Float32Array(L);
    this.touched = [];
    this.claim = new Array(L).fill(null); // vehicle that has waited longest for room in each lane

    this.nodeBusyUntil = new Float64Array(n);
    this.nodeBusyEdge = new Int32Array(n).fill(-1);

    // Directions at each edge's start and end, for turn angles and lane choice.
    this.startDx = new Float32Array(E);
    this.startDz = new Float32Array(E);
    this.endDx = new Float32Array(E);
    this.endDz = new Float32Array(E);
    const p = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    for (let e = 0; e < E; e++) {
      net.pointAt(e, Math.min(6, net.len[e] * 0.3), p);
      let l = Math.hypot(p.dx, p.dz) || 1;
      this.startDx[e] = p.dx / l;
      this.startDz[e] = p.dz / l;
      net.pointAt(e, Math.max(0, net.len[e] - Math.min(6, net.len[e] * 0.3)), p);
      l = Math.hypot(p.dx, p.dz) || 1;
      this.endDx[e] = p.dx / l;
      this.endDz[e] = p.dz / l;
    }

    // Junction character: "simple" nodes are just bends or splits of one road; "merge" nodes
    // feed every approach into a single road (ramps joining a freeway), so nothing crosses.
    this.nodeSimple = new Uint8Array(n);
    this.nodeMerge = new Uint8Array(n);
    this.nodeMaxRank = new Uint8Array(n);
    this.nodeMinRank = new Uint8Array(n).fill(255);
    for (let i = 0; i < n; i++) {
      const nb = new Set();
      for (let k = net.outStart[i]; k < net.outStart[i + 1]; k++) nb.add(net.to[net.outEdges[k]]);
      for (let k = net.inStart[i]; k < net.inStart[i + 1]; k++) {
        const e = net.inEdges[k];
        nb.add(net.from[e]);
        if (net.rank[e] > this.nodeMaxRank[i]) this.nodeMaxRank[i] = net.rank[e];
        if (net.rank[e] < this.nodeMinRank[i]) this.nodeMinRank[i] = net.rank[e];
      }
      this.nodeSimple[i] = nb.size <= 2 ? 1 : 0;
      this.nodeMerge[i] = net.outStart[i + 1] - net.outStart[i] === 1 ? 1 : 0;
    }

    // Expected uncongested traversal time (posted-speed driving + average control delay).
    this.expT = new Float32Array(E);
    this.ctrlDelay = new Float32Array(E);
    for (let e = 0; e < E; e++) {
      let d0 = 0;
      if (net.ctrl[e] === CTRL.SIGNAL && signals.controllerOf[e] >= 0) d0 = signals.uniformDelay(e);
      else if (net.ctrl[e] === CTRL.STOP) d0 = 5;
      else if (net.ctrl[e] === CTRL.YIELD) d0 = 2;
      else if (!this.nodeSimple[net.to[e]] && net.rank[e] < this.nodeMaxRank[net.to[e]]) d0 = 1.5;
      this.ctrlDelay[e] = d0;
      this.expT[e] = net.len[e] / Math.max(1, net.vsim[e]) + d0;
    }
    this.ema = new Float32Array(E).fill(1);
    this.congestion = new Float32Array(E).fill(1);
    this.lastObs = new Float64Array(E).fill(-1e9);
    this.flowCount = new Uint32Array(E); // vehicles that left each edge since the last reset

    this.stat = { completed: 0, sumTrip: 0, sumFF: 0, lifted: 0, rerouted: 0, recentActual: 0, recentFF: 0 };
    this.onArrive = null;
    this.onEdgeExit = null;
    this.redViolations = 0;
    this._a = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    this._b = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
  }

  setSample(sample) {
    this.capScale = 1 / clamp(sample, 0.05, 1);
    for (const v of this.vehicles) this.applyScale(v);
  }

  applyScale(v) {
    const k = this.capScale;
    v.effLen = v.len * k;
    v.s0 = v.s0base * k;
    v.T = v.Tbase * k;
  }

  // --- Vehicle lifecycle ----------------------------------------------------------------

  pickCarType() {
    return this.rng.weighted(CAR_TYPES, CAR_WEIGHTS);
  }

  paintFor(type) {
    if (FIXED_PAINT[type]) return FIXED_PAINT[type];
    if (type === 'truck' || type === 'semi') return this.rng.weighted(['#f2f2ef', '#d8d4cc', '#2e5fa8', '#a3262a', '#2f5d4a'], [6, 2, 1, 1, 1]);
    return this.rng.weighted(PAINT.map((x) => x[0]), PAINT.map((x) => x[1]));
  }

  plate() {
    const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
    const r = this.rng;
    const l = () => L[r.int(0, L.length - 1)];
    return `${l()}${l()}${l()}-${r.int(1000, 9999)}`;
  }

  /**
   * Room at the start of a lane (m). An empty lane always has room, however short the edge:
   * OSM splits roads into many short pieces and a car may straddle several of them.
   */
  laneFree(e, lane) {
    const arr = this.laneCars[this.laneStart[e] + lane];
    if (!arr || !arr.length) return 1e6;
    const t = arr[arr.length - 1];
    return t.s - t.effLen;
  }

  /** Room at the start of a lane `ahead` seconds from now, if its last car keeps moving. */
  roomAhead(e, lane, ahead) {
    const arr = this.laneCars[this.laneStart[e] + lane];
    if (!arr || !arr.length) return 1e6;
    const t = arr[arr.length - 1];
    return t.s - t.effLen + t.v * ahead;
  }

  /** Real-world room at the start of a lane (ignores the sampling scale). */
  realRoom(e, lane) {
    const arr = this.laneCars[this.laneStart[e] + lane];
    if (!arr || !arr.length) return 1e6;
    const t = arr[arr.length - 1];
    return t.s - t.len;
  }

  tailOf(e, lane) {
    const arr = this.laneCars[this.laneStart[e] + lane];
    return arr && arr.length ? arr[arr.length - 1] : null;
  }

  laneArray(laneId) {
    let arr = this.laneCars[laneId];
    if (!arr) arr = this.laneCars[laneId] = [];
    if (!this.laneOn[laneId]) {
      this.laneOn[laneId] = 1;
      this.active.push(laneId);
    }
    return arr;
  }

  /** Signed turn angle (rad) at the junction between edges a and b: positive = right, negative = left. */
  turnAngle(a, b) {
    const ax = this.endDx[a];
    const az = this.endDz[a];
    const bx = this.startDx[b];
    const bz = this.startDz[b];
    return Math.atan2(ax * bz - az * bx, ax * bx + az * bz);
  }

  /** Lanes of edge `ne` (route index `ri`) that lead to the turn after it: [lo, hi]. */
  allowedLanes(v, ne, ri) {
    const net = this.net;
    const n = Math.max(1, net.lanes[ne]);
    const after = ri + 1 < v.route.length ? v.route[ri + 1] : -1;
    let lo = 0;
    let hi = n - 1;
    if (after >= 0 && n > 1) {
      const ang = this.turnAngle(ne, after);
      if (ang > 0.5) hi = n >= 3 ? 1 : 0;
      else if (ang < -0.5) lo = n >= 3 ? n - 2 : n - 1;
      else {
        // Taking an exit ramp at a shallow fork: keep right, so a backed-up ramp only ever
        // blocks the right lane (through traffic picks the freer lanes on its own).
        const node = net.to[ne];
        const exitRamp = (net.cls[after] === 1 || net.cls[after] === 3 || net.cls[after] === 5) && net.cls[after] !== net.cls[ne];
        if (exitRamp && net.outStart[node + 1] - net.outStart[node] >= 2) {
          let rightmost = true;
          for (let k = net.outStart[node]; k < net.outStart[node + 1]; k++) {
            const o = net.outEdges[k];
            if (o !== after && net.to[o] !== net.from[ne] && this.turnAngle(ne, o) > ang) rightmost = false;
          }
          if (rightmost) hi = 0;
        }
      }
    }
    return [lo, hi];
  }

  /** Lane to take on edge `ne` (route index `ri`), given the turn after it. */
  chooseLane(v, ne, ri) {
    const n = Math.max(1, this.net.lanes[ne]);
    if (n === 1) return 0;
    const [lo, hi] = this.allowedLanes(v, ne, ri);
    if (v.siren) {
      // Sirens take the inside lane, where traffic can pull right.
      return hi;
    }
    // Keep to the same lane through the many splits of one road unless a turn needs another
    // lane or this one is backed up: constant lane hopping makes phantom merges.
    let best = lo;
    let bestFree = -Infinity;
    for (let l = lo; l <= hi; l++) {
      const f = this.laneFree(ne, l) - this.reserved[this.laneStart[ne] + l] + this.rng.next() * 3;
      if (f > bestFree) {
        bestFree = f;
        best = l;
      }
    }
    const keep = Math.min(v.lane, n - 1);
    if (keep >= lo && keep <= hi && keep !== best) {
      const fk = this.laneFree(ne, keep) - this.reserved[this.laneStart[ne] + keep];
      if (fk > 120 || fk >= bestFree - 20) return keep;
    }
    return best;
  }

  /**
   * Put a trip on the road. Returns the vehicle, or null when there is no room yet.
   * @param {object} trip {route, purpose, type?, from?, to?, siren?, startS?, destS?, color?}
   */
  spawn(trip, now) {
    const net = this.net;
    const route = trip.route;
    if (!route || !route.length) return null;
    const e = route[0];
    const type = trip.type || this.pickCarType();
    const spec = VEHICLE_TYPES[type];
    const len0 = net.len[e];
    // Driveways are spread along a street (and cars enter anywhere in a gateway's queue), so
    // pick a spot along the first edge rather than one fixed point.
    let s = trip.startS ?? (net.nodeGateway[net.from[e]] ? spec.len + this.rng.next() * Math.min(250, len0 * 0.8)
      : len0 * (0.15 + 0.7 * this.rng.next()));
    s = clamp(s, Math.min(spec.len, len0 * 0.5), Math.max(spec.len, len0 - 1));
    const r = this.rng;
    const v = {
      id: this.nextId++,
      type,
      len: spec.len,
      wid: spec.wid,
      a: spec.a * r.range(0.9, 1.1),
      b: spec.b,
      Tbase: r.range(1.0, 1.5),
      s0base: r.range(1.8, 2.4),
      vf: spec.vf * r.range(0.92, 1.1),
      effLen: spec.len,
      s0: 2,
      T: 1.2,
      color: trip.color || this.paintFor(type),
      plate: this.plate(),
      edge: e,
      s,
      lane: 0,
      v: 0,
      acc: 0,
      brake: 0,
      turn: 0,
      fade: 0,
      fadeDir: 1,
      siren: !!trip.siren,
      pull: 0,
      pullUntil: 0,
      purpose: trip.purpose || 'trip',
      fromBuilding: trip.from ?? -1,
      toBuilding: trip.to ?? -1,
      departed: now,
      route,
      ri: 0,
      destS: trip.destS ?? Math.min(net.len[route[route.length - 1]], Math.max(net.len[route[route.length - 1]] * 0.6, 4)),
      enterT: now,
      waitT: 0,
      stopped: 0,
      stoppedAtStop: false,
      squeeze: false,
      go: false,
      wait: WAIT.NONE,
      nextLane: 0,
      prevE1: -1, prevL1: 0, prevE2: -1, prevL2: 0, offStart: 0,
      odo: 0,
      ff: trip.ff || 0,
      trip,
      dead: false,
      leaving: false,
      onScene: false,
    };
    v.sab = 2 * Math.sqrt(v.a * v.b);
    this.applyScale(v);
    // Lane with room at s.
    const nl = Math.max(1, net.lanes[e]);
    let chosen = -1;
    let bestRoom = -Infinity;
    for (let l = 0; l < nl; l++) {
      const arr = this.laneCars[this.laneStart[e] + l];
      let ahead = null;
      let behind = null;
      if (arr) {
        for (let i = 0; i < arr.length; i++) {
          if (arr[i].s >= s) ahead = arr[i];
          else {
            behind = arr[i];
            break;
          }
        }
      }
      const roomAhead = ahead ? ahead.s - ahead.effLen - s : Infinity;
      // The car behind can brake for a merging car, as long as it isn't on top of it.
      const roomBehind = behind ? s - v.effLen - behind.s - behind.v * 0.6 + 1 : Infinity;
      const room = Math.min(roomAhead, roomBehind);
      if (room > 2 && room > bestRoom) {
        bestRoom = room;
        chosen = l;
      }
    }
    if (chosen < 0) {
      if (!trip.force) {
        this.nextId--;
        return null;
      }
      chosen = 0; // emergency units leave the station regardless; traffic makes way
    }
    v.lane = chosen;
    v.offStart = net.laneOffset(e, chosen);
    // Cars arriving from outside the county come in at highway speed (matching the car ahead);
    // cars pulling out of a driveway start slowly.
    if (net.nodeGateway[net.from[e]]) {
      const ahead = this.laneCars[this.laneStart[e] + chosen];
      let lead = null;
      if (ahead) for (let i = ahead.length - 1; i >= 0; i--) if (ahead[i].s > s) { lead = ahead[i]; break; }
      v.v = Math.min(net.vsim[e] * 0.9, lead ? lead.v + 1 : Infinity);
    } else {
      v.v = Math.min(net.vsim[e] * 0.5, 8);
    }
    v.nextLane = route.length > 1 ? this.chooseLane(v, route[1], 1) : 0;
    insertSorted(this.laneArray(this.laneStart[e] + chosen), v);
    this.vehicles.push(v);
    if (v.siren) this.sirenCount++;
    v.expectedSec = trip.ff || 0; // ORS free-flow trip time (what drive-time maps show)
    // The simulation's own uncongested trip time (posted-speed driving plus average signal and
    // stop-sign waits): the baseline for delay statistics.
    let ffSim = 0;
    for (let i = 0; i < route.length; i++) ffSim += this.expT[route[i]];
    v.ffSim = ffSim;
    return v;
  }

  /** Replace a vehicle's remaining route (it continues from the end of its current edge). */
  reroute(v, edges) {
    const r = new Int32Array(edges.length + 1);
    r[0] = v.edge;
    r.set(edges, 1);
    v.route = r;
    v.ri = 0;
    v.destS = Math.min(this.net.len[r[r.length - 1]], Math.max(this.net.len[r[r.length - 1]] * 0.6, 4));
    v.nextLane = r.length > 1 ? this.chooseLane(v, r[1], 1) : 0;
  }

  /** End an on-scene stop: the vehicle fades out where it stands. */
  release(v) {
    v.onScene = false;
    v.leaving = true;
    v.fadeDir = -1;
  }

  /** Take a vehicle off the network (it fades out where it is). */
  retire(v) {
    if (v.leaving) return;
    v.leaving = true;
    v.fadeDir = -1;
    const arr = this.laneCars[this.laneStart[v.edge] + v.lane];
    if (arr) removeFrom(arr, v);
  }

  // --- Simulation step ----------------------------------------------------------------------

  step(dt, now) {
    this.time = now;
    this.dt = dt;
    for (const l of this.touched) this.reserved[l] = 0;
    this.touched.length = 0;
    // Sirens clear the way: cars ahead on the same and next edge slow and pull over.
    if (this.sirenCount > 0) {
      let n = 0;
      for (const v of this.vehicles) {
        if (v.siren && !v.leaving && !v.dead) {
          n++;
          if (!v.onScene) this.clearAhead(v, now);
        }
      }
      this.sirenCount = n;
    }
    this.reroutesThisStep = 0;
    this.signals.update(now, this);
    // Accelerations, lane by lane, front to back.
    const act = this.active;
    let w = 0;
    for (let i = 0; i < act.length; i++) {
      const lane = act[i];
      const arr = this.laneCars[lane];
      if (!arr || !arr.length) {
        this.laneOn[lane] = 0;
        continue;
      }
      act[w++] = lane;
      const e = this.laneEdge[lane];
      for (let k = 0; k < arr.length; k++) {
        const v = arr[k];
        v.acc = this.accel(v, k === 0 ? null : arr[k - 1], e, k === 0, now);
      }
    }
    act.length = w;
    // Motion and edge transitions.
    const vs = this.vehicles;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.leaving || v.onScene) {
        this.fadeStep(v, dt);
        continue;
      }
      this.move(v, dt, now);
    }
    let k = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.dead) continue;
      vs[k++] = v;
    }
    vs.length = k;
  }

  fadeStep(v, dt) {
    if (v.onScene) {
      v.v = 0;
      v.brake = 1;
      return;
    }
    v.fade = clamp(v.fade + (v.fadeDir * dt) / FADE_TIME, 0, 1);
    if (v.fadeDir < 0) {
      v.v = Math.max(0, v.v - 4 * dt);
      if (v.fade <= 0) v.dead = true;
    }
  }

  clearAhead(sv, now) {
    const net = this.net;
    const e = sv.edge;
    const L0 = this.laneStart[e];
    const nl = Math.max(1, net.lanes[e]);
    for (let l = 0; l < nl; l++) {
      const arr = this.laneCars[L0 + l];
      if (!arr) continue;
      for (const o of arr) {
        if (o !== sv && o.s > sv.s && o.s - sv.s < 140) o.pullUntil = now + 4;
      }
    }
    if (sv.ri + 1 < sv.route.length && net.len[e] - sv.s < 100) {
      const ne = sv.route[sv.ri + 1];
      const L1 = this.laneStart[ne];
      for (let l = 0; l < Math.max(1, net.lanes[ne]); l++) {
        const arr = this.laneCars[L1 + l];
        if (!arr) continue;
        for (const o of arr) if (o.s < 80) o.pullUntil = now + 4;
      }
    }
  }

  desiredSpeed(v, e) {
    let v0 = this.net.vsim[e] * v.vf * this.speedFactor;
    if (v.siren) v0 = Math.min(32, this.net.vsim[e] * 1.25 + 3);
    else if (v.pullUntil > this.time) v0 = Math.min(v0, 3);
    return v0;
  }

  idm(v, v0, gap, vLead) {
    const s = v.v;
    const dyn = s * v.T + (s * (s - vLead)) / v.sab;
    const sStar = v.s0 + (dyn > 0 ? dyn : 0);
    let free = 1;
    if (v0 > 0.1) {
      const r = s / v0;
      const r2 = r * r;
      free = r2 * r2;
    }
    const q = sStar / (gap > 0.05 ? gap : 0.05);
    return v.a * (1 - free - q * q);
  }

  /**
   * Braking for a stop line `dist` meters ahead. Uses real-world spacing even when capacity is
   * scaled for sampling, so cars stop at the line rather than short of it.
   */
  idmLine(v, v0, dist) {
    const s = v.v;
    const sStar = v.s0base + s * v.Tbase + (s * s) / v.sab;
    let free = 1;
    if (v0 > 0.1) {
      const r = s / v0;
      const r2 = r * r;
      free = r2 * r2;
    }
    const g = dist + STOP_OFFSET > 0.05 ? dist + STOP_OFFSET : 0.05;
    const q = sStar / g;
    return v.a * (1 - free - q * q);
  }

  accel(v, leader, e, front, now) {
    const net = this.net;
    let v0 = this.desiredSpeed(v, e);
    const dist = net.len[e] - v.s;
    let acc = Infinity;
    v.wait = WAIT.NONE;
    const last = v.ri >= v.route.length - 1;
    if (leader && !(v.siren && (leader.pullUntil > now || leader.v < 3))) {
      const gap = leader.s - leader.effLen - v.s;
      acc = this.idm(v, v0, gap, leader.v);
      if (leader.v < 0.8 && gap < 12) v.wait = WAIT.QUEUE;
    }
    if (!last) {
      const ne = v.route[v.ri + 1];
      const look = Math.max(30, (v.v * v.v) / 4 + 20);
      if (dist < look && (front || v.v > 6)) {
        // Slow for the turn ahead.
        const ang = this.turnAngle(e, ne);
        const abs = ang < 0 ? -ang : ang;
        if (abs > 0.5) {
          // Left turns sweep a wider arc than right turns, so they're taken a little faster.
          const vt = (abs > 1.9 ? 3 : abs > 1.2 ? 4.5 : abs > 0.8 ? 7 : 10) * (ang < 0 ? 1.3 : 1);
          const vmax = Math.sqrt(vt * vt + 2 * 1.6 * Math.max(0, dist - 3));
          if (vmax < v0) v0 = vmax;
          v.turn = ang > 0 ? 1 : -1;
        } else v.turn = 0;
        if (front) {
          const verdict = this.permission(v, e, ne, dist, now);
          v.go = verdict === WAIT.NONE;
          if (!v.go) {
            v.wait = verdict;
            acc = Math.min(acc, this.idmLine(v, v0, dist));
          } else {
            const tail = this.tailOf(ne, v.nextLane);
            if (tail && !(v.siren && tail.pullUntil > now)) {
              // A car squeezing in after a long wait closes up to the real car ahead.
              acc = Math.min(acc, v.squeeze ? this.idmLine(v, v0, dist + tail.s - tail.len - 1.3)
                : this.idm(v, v0, dist + tail.s - tail.effLen, tail.v));
            }
            if (v.siren && !this.nodeSimple[net.to[e]]) {
              // Sirens slow to cross junctions they don't control.
              const vmax = Math.sqrt(36 + 2 * 2.5 * Math.max(0, dist - 2));
              if (vmax < v0) v0 = vmax;
            }
          }
        }
      } else {
        v.turn = 0;
        if (front) v.go = false;
      }
    } else {
      v.turn = 0;
      v.go = true;
    }
    if (acc === Infinity) acc = this.idm(v, v0, Infinity, 0);
    else acc = Math.min(acc, this.idm(v, v0, Infinity, 0));
    return clamp(acc, -9, v.a);
  }

  permission(v, e, ne, dist, now) {
    const net = this.net;
    const sig = this.signals;
    const ctrl = net.ctrl[e];
    const node = net.to[e];
    const siren = v.siren;
    if (ctrl === CTRL.SIGNAL && !sig.internal[e] && sig.controllerOf[e] >= 0 && !siren) {
      const st = sig.state(e, now);
      if (st === 'Y' && !v.yellowGo) {
        // Stop if it can be done comfortably; otherwise go through on the yellow.
        const need = (v.v * v.v) / (2 * Math.max(0.5, dist));
        if (need < 3.2 || dist > v.v * 3.5) return WAIT.RED;
        v.yellowGo = true;
      }
      // A car that entered on yellow finishes crossing; anyone else stops for red, except a
      // right turn on red (legal in North Carolina) after a full stop, yielding to traffic.
      // Off-ramp right turns are usually channelized with a yield, so those roll through.
      if (st === 'R' && !(v.yellowGo && dist < v.v * 2.5 + 3)) {
        const rightTurn = this.turnAngle(e, ne) > 0.6;
        const slip = net.cls[e] === 1 || net.cls[e] === 3;
        const ready = slip ? v.v < 6 && dist < 8 : v.v < 0.5 && dist < v.s0base + 4;
        if (!(rightTurn && ready && !this.rtorConflict(v, e, ne, node))) return WAIT.RED;
        v.rtor = true;
      }
    }
    // Room in our lane on the next edge. If it's full, or another car has been waiting to get
    // into it (a merging car), take any other lane the next turn allows that has room: drivers
    // merge into whichever lane has a gap, and move over for traffic joining from a ramp.
    // A car that is driving away ahead of us will have made room by the time we reach the line
    // (so a moving platoon flows through junctions; `move` still checks real room at the line).
    const ahead = dist > 2 ? Math.min(3, dist / Math.max(v.v, 2)) : 0;
    let laneId = this.laneStart[ne] + v.nextLane;
    let free = this.roomAhead(ne, v.nextLane, ahead) - this.reserved[laneId];
    const canStop = v.v * v.v < 6 * Math.max(0.5, dist - 1);
    // Fast freeway traffic moves over for a merging car but doesn't brake for one.
    const stopsForClaim = canStop && !(v.v > 12 && (net.cls[e] === 0 || net.cls[e] === 2));
    if (net.lanes[ne] > 1 && !siren) {
      const need0 = v.effLen + MIN_GAP;
      const held = canStop && this.heldFor(laneId, v, ne);
      if (free < need0 || held) {
        const [lo, hi] = this.allowedLanes(v, ne, v.ri + 1);
        let best = held ? need0 - 1 : free;
        for (let l = lo; l <= hi; l++) {
          if (l === v.nextLane) continue;
          const id = this.laneStart[ne] + l;
          const f = this.roomAhead(ne, l, ahead) - this.reserved[id];
          if (f > best + 1 && !this.heldFor(id, v, ne)) {
            best = f;
            free = f;
            laneId = id;
            v.nextLane = l;
          }
        }
      }
    }
    if (!siren) {
      // Take turns at merges and lane drops: a car that has waited for this lane claims it,
      // and later arrivals let it in first (unless they're too close to stop).
      if (stopsForClaim && this.heldFor(laneId, v, ne)) return WAIT.BLOCKED;
      // A car already committed and too close to stop keeps going if there is any room; one
      // blocked for a long time inches in on real-world spacing, ignoring the sampling scale
      // (breaks gridlock on tiny loops; `move` checks the same room at the line).
      const committed = v.go && dist < v.v * this.dt * 2 + 1;
      let room = free >= (committed ? v.len + 0.5 : v.effLen + MIN_GAP);
      v.squeeze = false;
      if (!room && v.waitT > SQUEEZE_AFTER) room = v.squeeze = this.realRoom(ne, v.nextLane) - this.reserved[laneId] >= v.len + 0.5;
      if (!room) {
        if (v.waitT > 6 && !this.claim[laneId]) this.claim[laneId] = v;
        return WAIT.BLOCKED;
      }
    }
    if (!siren) {
      if (ctrl === CTRL.STOP && !v.stoppedAtStop && v.waitT < 20) return WAIT.STOP;
      if (ctrl !== CTRL.SIGNAL && !this.nodeSimple[node]) {
        const minor = net.rank[e] < this.nodeMaxRank[node] || ctrl === CTRL.STOP || ctrl === CTRL.YIELD;
        // All-way junctions of equal streets take turns; freeway and arterial merges don't
        // (gap acceptance and lane space handle those).
        const allEqual = this.nodeMaxRank[node] === this.nodeMinRank[node] && this.nodeMaxRank[node] <= 4;
        if ((minor || allEqual) && !this.nodeMerge[node] && v.waitT < ESCALATE_BUSY && this.nodeBusyUntil[node] > now && this.nodeBusyEdge[node] !== e) {
          return WAIT.CONFLICT;
        }
        if (v.waitT < ESCALATE_YIELD && this.mustYield(v, e, ne, node, now)) {
          const merging = net.lanes[ne] > 1 && Math.abs(this.turnAngle(e, ne)) < 0.5;
          if (!merging || !this.mergeElsewhere(v, e, ne, node, now)) {
            // Waiting to merge: claim the lane so cars arriving on the main road move over.
            if (merging && v.waitT > 3 && !this.claim[laneId]) this.claim[laneId] = v;
            return WAIT.YIELD;
          }
          laneId = this.laneStart[ne] + v.nextLane;
        }
      }
    }
    // May cross this step: hold the space so a car from another lane or approach can't take it too.
    if (dist <= v.v * this.dt * 1.5 + v.a * this.dt * this.dt + 1.5) {
      this.reserved[laneId] += v.effLen + MIN_GAP;
      this.touched.push(laneId);
    }
    return WAIT.NONE;
  }

  /** Another car has been waiting longer to get into this lane, and still is. */
  heldFor(laneId, v, ne) {
    const c = this.claim[laneId];
    if (!c || c === v) return false;
    const valid = !c.dead && !c.leaving && (c.wait === WAIT.BLOCKED || c.wait === WAIT.YIELD) && c.ri + 1 < c.route.length
      && c.route[c.ri + 1] === ne && this.laneStart[ne] + c.nextLane === laneId && this.net.len[c.edge] - c.s < c.s0base + 6;
    if (!valid) {
      this.claim[laneId] = null;
      return false;
    }
    return c.waitT > v.waitT;
  }

  /** A merging car blocked in its chosen lane tries the road's other lanes for a gap. */
  mergeElsewhere(v, e, ne, node, now) {
    const keep = v.nextLane;
    const [lo, hi] = this.allowedLanes(v, ne, v.ri + 1);
    for (let l = lo; l <= hi; l++) {
      if (l === keep) continue;
      const id = this.laneStart[ne] + l;
      if (this.laneFree(ne, l) - this.reserved[id] < v.effLen + MIN_GAP || this.heldFor(id, v, ne)) continue;
      v.nextLane = l;
      if (!this.mustYield(v, e, ne, node, now)) return true;
    }
    v.nextLane = keep;
    return false;
  }

  /** Traffic with the green that would collide with a right turn on red into edge `ne`. */
  rtorConflict(v, e, ne, node) {
    const net = this.net;
    for (let k = net.inStart[node]; k < net.inStart[node + 1]; k++) {
      const oe = net.inEdges[k];
      if (oe === e) continue;
      const L0 = this.laneStart[oe];
      const nl = Math.max(1, net.lanes[oe]);
      for (let l = 0; l < nl; l++) {
        const arr = this.laneCars[L0 + l];
        if (!arr || !arr.length) continue;
        const f = arr[0];
        if (f.ri >= f.route.length - 1 || f.route[f.ri + 1] !== ne) continue;
        if (f.v < 0.5 && !f.go) continue; // stopped at its own red
        if ((net.len[oe] - f.s) / Math.max(f.v, 1) < 5) return true;
      }
    }
    // Room for the turn: the lane we're turning into must not be crowded at its start.
    const tail = this.tailOf(ne, v.nextLane);
    return !!tail && tail.s - tail.effLen < v.effLen + 6;
  }

  mustYield(v, e, ne, node, now) {
    const net = this.net;
    const myRank = net.rank[e];
    const ctrl = net.ctrl[e];
    const yieldy = ctrl === CTRL.STOP || ctrl === CTRL.YIELD;
    const meRound = net.flags[e] & FLAG.ROUNDABOUT;
    // A right turn only conflicts with traffic heading into the same street direction.
    const rightTurn = this.turnAngle(e, ne) > 0.5;
    for (let k = net.inStart[node]; k < net.inStart[node + 1]; k++) {
      const oe = net.inEdges[k];
      if (oe === e) continue;
      if (net.ctrl[oe] === CTRL.SIGNAL) continue;
      const oRound = net.flags[oe] & FLAG.ROUNDABOUT;
      let pri;
      if (meRound && !oRound) continue; // circulating traffic has the right of way
      if (oRound && !meRound) pri = true;
      else if (net.rank[oe] > myRank) pri = true;
      else if (net.rank[oe] === myRank && yieldy && !(net.ctrl[oe] === CTRL.STOP || net.ctrl[oe] === CTRL.YIELD)) pri = true;
      else pri = false;
      if (!pri) continue;
      const L0 = this.laneStart[oe];
      const nl = Math.max(1, net.lanes[oe]);
      for (let l = 0; l < nl; l++) {
        const arr = this.laneCars[L0 + l];
        if (!arr || !arr.length) continue;
        const f = arr[0];
        if (f.leaving) continue;
        const fdist = net.len[oe] - f.s;
        if (fdist > 160) continue;
        // A higher-priority car that is itself stopped (queued, at its own sign) doesn't hold us.
        if (f.v < 0.5 && !f.go) continue;
        if (f.ri >= f.route.length - 1) continue;
        const fne = f.route[f.ri + 1];
        if (rightTurn && fne !== ne) continue;
        if (fne === ne && f.nextLane !== v.nextLane && net.lanes[ne] > 1) continue;
        // Merging at speed needs a shorter gap than pulling out from a stop.
        const need = fne === ne ? (v.v > 12 ? CRIT_MERGE * 0.65 : CRIT_MERGE) : CRIT_CROSS;
        const eta = fdist / Math.max(f.v, 1);
        if (eta < need) return true;
      }
    }
    return false;
  }

  move(v, dt, now) {
    const net = this.net;
    const s0 = v.v;
    const a = v.acc;
    let v1 = s0 + a * dt;
    let ds;
    if (v1 <= 0) {
      ds = a < 0 ? Math.min(s0 * dt, (s0 * s0) / (-2 * a)) : 0;
      v1 = 0;
    } else {
      ds = 0.5 * (s0 + v1) * dt;
    }
    v.v = v1;
    v.s += ds;
    v.odo += ds;
    v.brake = a < -0.9 || v1 < 0.15 ? 1 : 0;
    if (v1 < 0.3) v.stopped += dt;
    else v.stopped = 0;
    const e = v.edge;
    const len = net.len[e];
    const last = v.ri >= v.route.length - 1;
    // Stop-sign compliance and waiting at the line.
    const atLine = len - v.s < v.s0base + 4 && v.wait !== WAIT.NONE && v.wait !== WAIT.QUEUE;
    if (atLine && v1 < 0.4) {
      v.waitT += dt;
      if (net.ctrl[e] === CTRL.STOP) v.stoppedAtStop = true;
    } else if (v1 > 3) v.waitT = 0;
    v.pull += ((v.pullUntil > now ? 1 : 0) - v.pull) * Math.min(1, dt * 1.5);
    if (v.fadeDir > 0) {
      v.fade = Math.min(1, v.fade + dt / FADE_TIME);
      if (v.fade >= 1) v.fadeDir = 0;
    }
    if (last) {
      if (v.s >= v.destS) this.arrive(v, now);
      return;
    }
    if (v.s >= len) {
      // Last check at the line: is there really room in our lane on the next edge?
      let ok = v.go;
      if (ok && !v.siren) {
        const ne = v.route[v.ri + 1];
        const tail = this.tailOf(ne, Math.min(v.nextLane, Math.max(1, net.lanes[ne]) - 1));
        if (tail && tail.s - tail.len < v.len + 0.5) ok = false;
      }
      if (!ok) {
        v.s = len - 0.05;
        v.v = Math.min(v.v, 0.5);
        if (!v.go) this.overruns = (this.overruns || 0) + 1;
      } else {
        this.transition(v, now);
      }
    }
    // Escalation for vehicles stuck at the front of a lane.
    if (!v.dead && !v.leaving && v.waitT > REROUTE_AFTER && v.wait === WAIT.BLOCKED && !v.rerouteTried && this.reroutesThisStep < 12) {
      v.rerouteTried = true;
      this.reroutesThisStep++;
      this.needReroute?.(v);
    }
    if (!v.dead && !v.leaving && v.stopped > LIFT_AFTER && !v.siren) {
      this.stat.lifted++;
      this.arrive(v, now, true);
    }
  }

  transition(v, now) {
    const net = this.net;
    const e = v.edge;
    const ne = v.route[v.ri + 1];
    // Count a red-light runner (should never happen: cars entering on yellow don't count).
    if (net.ctrl[e] === CTRL.SIGNAL && !this.signals.internal[e] && this.signals.controllerOf[e] >= 0) {
      if (!v.siren && !v.yellowGo && !v.rtor && this.signals.state(e, now) === 'R') this.redViolations++;
      this.signals.count(e);
    }
    this.observe(e, now - v.enterT, now);
    const oldLane = this.laneStart[e] + v.lane;
    const arr = this.laneCars[oldLane];
    if (arr) removeFrom(arr, v);
    const node = net.to[e];
    if (!this.nodeSimple[node] && net.ctrl[e] !== CTRL.SIGNAL) {
      const cross = clamp((10 + v.len) / Math.max(v.v, 4), 0.8, 3) * Math.sqrt(this.capScale);
      if (this.nodeBusyUntil[node] < now + cross) {
        this.nodeBusyUntil[node] = now + cross;
        this.nodeBusyEdge[node] = e;
      }
    }
    v.s -= net.len[e];
    if (v.s < 0) v.s = 0;
    v.prevE2 = v.prevE1;
    v.prevL2 = v.prevL1;
    v.prevE1 = e;
    v.prevL1 = v.lane;
    v.offStart = net.laneOffset(e, v.lane);
    v.edge = ne;
    v.lane = Math.min(v.nextLane, Math.max(1, net.lanes[ne]) - 1);
    // Never land inside the car ahead (a fast car can overshoot the junction by several meters).
    const tail = this.tailOf(ne, v.lane);
    if (tail && v.s > tail.s - tail.len - 0.5) {
      v.s = Math.max(0, tail.s - tail.len - 0.5);
      if (v.v > tail.v) v.v = tail.v;
    }
    v.ri++;
    v.yellowGo = false;
    v.rtor = false;
    v.squeeze = false;
    v.enterT = now;
    v.stoppedAtStop = false;
    v.waitT = 0;
    v.go = false;
    v.rerouteTried = false;
    const laneId = this.laneStart[ne] + v.lane;
    if (this.claim[laneId] === v) this.claim[laneId] = null;
    insertSorted(this.laneArray(laneId), v);
    v.nextLane = v.ri + 1 < v.route.length ? this.chooseLane(v, v.route[v.ri + 1], v.ri + 1) : 0;
    if (this.onEdgeExit) this.onEdgeExit(e, v, now);
  }

  arrive(v, now, lifted = false) {
    if (v.leaving || v.onScene) return;
    // Patrols and other looping vehicles carry on with a new route instead of parking.
    if (!lifted && v.onRouteEnd) {
      const next = v.onRouteEnd(v, now);
      if (next && next.length) {
        this.reroute(v, next);
        return;
      }
    }
    if (v.holdOnArrival && !lifted) {
      // Emergency units stop at the scene with their lights on, out of the traffic lane.
      const arr = this.laneCars[this.laneStart[v.edge] + v.lane];
      if (arr) removeFrom(arr, v);
      v.onScene = true;
      v.v = 0;
      v.acc = 0;
      v.brake = 1;
      if (this.onArrive) this.onArrive(v, now, false);
      return;
    }
    this.retire(v);
    if (!lifted) {
      const tt = now - v.departed;
      this.stat.completed++;
      this.stat.sumTrip += tt;
      this.stat.sumFF += v.ffSim || 0;
      if (v.ffSim > 0) {
        const k = 0.02;
        this.stat.recentActual += (tt - this.stat.recentActual) * k;
        this.stat.recentFF += (v.ffSim - this.stat.recentFF) * k;
      }
    }
    if (this.onArrive) this.onArrive(v, now, lifted);
  }

  // --- Congestion ------------------------------------------------------------------------------

  observe(e, travelTime, now) {
    const r = clamp(travelTime / this.expT[e], 0.5, 15);
    // Weigh a new observation more when the last one is old.
    const k = clamp((now - this.lastObs[e]) / 120, 0.15, 0.5);
    this.ema[e] += (r - this.ema[e]) * k;
    this.lastObs[e] = now;
    this.congestion[e] = this.ema[e] > 1 ? this.ema[e] : 1;
    this.flowCount[e]++;
  }

  /** Relax edges nobody has driven lately back toward free flow, and flag stuck queues. */
  decay(now, dtSince) {
    const E = this.net.edgeCount;
    const f = Math.exp(-dtSince / 600);
    for (let e = 0; e < E; e++) {
      if (this.ema[e] !== 1 && now - this.lastObs[e] > 90) {
        this.ema[e] = 1 + (this.ema[e] - 1) * f;
        if (Math.abs(this.ema[e] - 1) < 0.002) this.ema[e] = 1;
        this.congestion[e] = this.ema[e] > 1 ? this.ema[e] : 1;
      }
    }
    // A queue that hasn't moved shows up before anyone gets through it.
    for (const lane of this.active) {
      const arr = this.laneCars[lane];
      if (!arr || !arr.length) continue;
      const v = arr[0];
      const e = this.laneEdge[lane];
      const elapsed = now - v.enterT;
      if (v.waitT > 45 || elapsed > this.expT[e] * 3 + 60) {
        const r = Math.min(15, elapsed / this.expT[e]);
        if (r > this.ema[e]) {
          this.ema[e] = r;
          this.congestion[e] = r;
          this.lastObs[e] = now;
        }
      }
    }
  }

  // --- Queries ----------------------------------------------------------------------------------

  /** Centerline point with lane offset at distance s of the vehicle's path (negative = previous edges). */
  pointOnPath(v, s, out) {
    const net = this.net;
    let e = v.edge;
    let lane = v.lane;
    let along = s;
    let offFrom = v.offStart;
    if (along < 0 && v.prevE1 >= 0) {
      along += net.len[v.prevE1];
      e = v.prevE1;
      lane = v.prevL1;
      offFrom = NaN;
      if (along < 0 && v.prevE2 >= 0) {
        along += net.len[v.prevE2];
        e = v.prevE2;
        lane = v.prevL2;
      }
    }
    if (along < 0) along = 0;
    net.pointAt(e, along, out);
    let off = net.laneOffset(e, lane);
    if (e === v.edge && !Number.isNaN(offFrom)) {
      // Drift smoothly across from the previous edge's lane position.
      const t = clamp(along / 14, 0, 1);
      const sm = t * t * (3 - 2 * t);
      off = offFrom + (off - offFrom) * sm;
    }
    off += v.pull * 1.6;
    const hl = Math.hypot(out.dx, out.dz) || 1;
    out.x += (-out.dz / hl) * off;
    out.z += (out.dx / hl) * off;
    return out;
  }

  /** Vehicle center and heading (unit vector including grade) into out {x,y,z,dx,dy,dz}. */
  pose(v, out) {
    const A = this.pointOnPath(v, v.s - v.len * 0.15, this._a);
    const B = this.pointOnPath(v, v.s - v.len * 0.85, this._b);
    let dx = A.x - B.x;
    let dy = A.y - B.y;
    let dz = A.z - B.z;
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-3) {
      dx = A.dx;
      dy = A.dy;
      dz = A.dz;
    } else {
      dx /= l;
      dy /= l;
      dz /= l;
    }
    out.x = (A.x + B.x) / 2;
    out.y = (A.y + B.y) / 2;
    out.z = (A.z + B.z) / 2;
    out.dx = dx;
    out.dy = dy;
    out.dz = dz;
    return out;
  }

  describe(v) {
    const net = this.net;
    let status = WAIT_LABEL[v.wait] || 'Moving';
    if (v.onScene) status = 'On scene';
    else if (v.siren) status = 'Responding with lights and siren';
    else if (v.wait === WAIT.NONE && v.v < 1) status = 'In traffic';
    else if (v.wait === WAIT.NONE && v.turn && net.len[v.edge] - v.s < 30) status = v.turn > 0 ? 'Turning right' : 'Turning left';
    else if (v.wait === WAIT.NONE && v.pull > 0.5) status = 'Pulling over for an emergency vehicle';
    else if (v.wait === WAIT.NONE && v.acc < -1) status = 'Braking';
    else if (v.wait === WAIT.NONE) status = 'Cruising';
    const remaining = this.remainingLength(v);
    return {
      road: net.edgeLabel(v.edge),
      heading: compass(this.endDx[v.edge], this.endDz[v.edge]),
      status,
      speedLimitMph: Math.round(net.posted[v.edge] / 1.609344),
      remainingM: remaining,
    };
  }

  remainingLength(v) {
    const net = this.net;
    let d = net.len[v.edge] - v.s;
    for (let i = v.ri + 1; i < v.route.length; i++) d += net.len[v.route[i]];
    return d;
  }

  stats() {
    let n = 0;
    let speed = 0;
    let stopped = 0;
    for (const v of this.vehicles) {
      if (v.leaving || v.fade < 0.5 || v.onScene) continue;
      n++;
      speed += v.v;
      if (v.v < 1) stopped++;
    }
    const st = this.stat;
    return {
      active: n,
      avgSpeedKmh: n ? (speed / n) * 3.6 : 0,
      stoppedShare: n ? stopped / n : 0,
      completed: st.completed,
      avgTripMin: st.completed ? st.sumTrip / st.completed / 60 : 0,
      avgDelayMin: st.completed ? (st.sumTrip - st.sumFF) / st.completed / 60 : 0,
      congestionIndex: st.recentFF > 0 ? Math.max(1, st.recentActual / st.recentFF) : 1,
      lifted: st.lifted,
      rerouted: st.rerouted,
    };
  }
}

function compass(dx, dz) {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const names = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
  return `${names[Math.round(((a + 360) % 360) / 45) % 8]}bound`;
}

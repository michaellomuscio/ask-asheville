// Traffic signals built from the OSM signal tags on the road graph.
//
// Every approach edge whose downstream end is signalized (ctrl = 3) belongs to a controller.
// Signalized nodes within ~50 m of each other (the two or four nodes of a divided-road
// intersection) share one controller; edges between them are inside the junction and run free.
// Approaches split into two phases by heading (the main axis, then the cross street); a
// signal with only one axis gets a short pedestrian phase so through traffic still stops.
//
// Two-phase signals are actuated, like most of Asheville's: at the end of every cycle each
// phase's next green is sized to what it saw (cars that went through plus cars still queued),
// so a quiet side street gets a short green and a backed-up off-ramp a long one, and the cycle
// stretches toward two minutes as the junction fills.

import { CTRL } from './graph.js';

const CLUSTER_M = 50;
export const YELLOW = 4;
export const ALL_RED = 2;
const MIN_GREEN = 10;
const PED_PHASE = 14;
const MAX_CYCLE = 130;
const SAT_FLOW = 0.5; // cars per second per lane once a queue is moving (1,800 an hour)
const START_LOSS = 2; // seconds lost getting a queue moving
const LOOK_M = 120; // how far back the detectors see a queue
const RAMP_WEIGHT = 1.5; // off-ramp queues get extra green so they don't back onto the freeway
const RAMP_LOOK_M = 400; // off-ramp queue detectors reach back up the ramp

export class Signals {
  /**
   * @param {import('./graph.js').RoadNetwork} net
   * @param {import('../core/rng.js').RNG} rng
   */
  constructor(net, rng) {
    this.net = net;
    const E = net.edgeCount;
    this.controllerOf = new Int32Array(E).fill(-1);
    this.phaseOf = new Int8Array(E).fill(-1);
    this.internal = new Uint8Array(E); // edge inside a signalized junction (runs free)
    this.passed = new Float32Array(E); // cars through each approach's stop line this cycle
    this.controllers = [];
    this.build(rng);
  }

  build(rng) {
    const net = this.net;
    const E = net.edgeCount;
    // Signalized junction nodes: the downstream ends of signalized approaches.
    const sigNode = new Map();
    for (let e = 0; e < E; e++) {
      if (net.ctrl[e] === CTRL.SIGNAL) sigNode.set(net.to[e], true);
    }
    const nodes = [...sigNode.keys()];
    // Union-find clustering of nearby signalized nodes.
    const parent = new Map(nodes.map((n) => [n, n]));
    const find = (a) => {
      let r = a;
      while (parent.get(r) !== r) r = parent.get(r);
      let c = a;
      while (parent.get(c) !== r) {
        const nx = parent.get(c);
        parent.set(c, r);
        c = nx;
      }
      return r;
    };
    const cell = new Map();
    const key = (x, z) => `${Math.floor(x / CLUSTER_M)},${Math.floor(z / CLUSTER_M)}`;
    for (const n of nodes) {
      const k = key(net.nodeX[n], net.nodeZ[n]);
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(n);
    }
    for (const n of nodes) {
      const cx = Math.floor(net.nodeX[n] / CLUSTER_M);
      const cz = Math.floor(net.nodeZ[n] / CLUSTER_M);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const list = cell.get(`${cx + dx},${cz + dz}`);
          if (!list) continue;
          for (const m of list) {
            if (m === n) continue;
            if (Math.hypot(net.nodeX[m] - net.nodeX[n], net.nodeZ[m] - net.nodeZ[n]) < CLUSTER_M) parent.set(find(m), find(n));
          }
        }
      }
    }
    const groups = new Map();
    for (const n of nodes) {
      const r = find(n);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(n);
    }
    const groupOf = new Map();
    for (const [r, g] of groups) for (const n of g) groupOf.set(n, r);

    // Approaches per group (excluding edges that start inside the same junction).
    const approaches = new Map();
    for (let e = 0; e < E; e++) {
      if (net.ctrl[e] !== CTRL.SIGNAL) continue;
      const g = groupOf.get(net.to[e]);
      if (g === undefined) continue;
      if (groupOf.get(net.from[e]) === g && net.len[e] < CLUSTER_M * 1.6) {
        this.internal[e] = 1;
        continue;
      }
      if (!approaches.has(g)) approaches.set(g, []);
      approaches.get(g).push(e);
    }

    const end = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    for (const [g, edges] of approaches) {
      // Heading of travel at each approach's stop line, folded onto [0, pi).
      const axis = edges.map((e) => {
        net.pointAt(e, Math.max(0, net.len[e] - 2), end);
        let a = Math.atan2(end.dz, end.dx);
        if (a < 0) a += Math.PI;
        return a;
      });
      // Main axis: the busiest approach (rank and lanes).
      let main = 0;
      for (let i = 1; i < edges.length; i++) {
        const w = net.rank[edges[i]] * 4 + net.lanes[edges[i]];
        const wm = net.rank[edges[main]] * 4 + net.lanes[edges[main]];
        if (w > wm) main = i;
      }
      const phaseEdges = [[], []];
      edges.forEach((e, i) => {
        let d = Math.abs(axis[i] - axis[main]);
        d = Math.min(d, Math.PI - d);
        phaseEdges[d < Math.PI / 4 ? 0 : 1].push(e);
      });
      const weight = (list) => list.reduce((s, e) => s + net.lanes[e] * (1 + net.rank[e] / 4), 0);
      const maxRank = Math.max(...edges.map((e) => net.rank[e]));
      let cycle = 60 + 8 * Math.max(0, edges.length - 2) + (maxRank >= 6 ? 20 : maxRank >= 5 ? 10 : 0);
      cycle = Math.min(120, Math.max(60, cycle));
      const phases = [];
      if (!phaseEdges[1].length) {
        // One axis only (mid-block crossing, T at a driveway): cars get most of the cycle.
        phases.push({ edges: phaseEdges[0], green: cycle - PED_PHASE - YELLOW - ALL_RED });
        phases.push({ edges: [], green: PED_PHASE - ALL_RED });
      } else {
        const lost = 2 * (YELLOW + ALL_RED);
        const w0 = weight(phaseEdges[0]);
        const w1 = weight(phaseEdges[1]);
        let g0 = Math.max(MIN_GREEN, ((cycle - lost) * w0) / (w0 + w1));
        let g1 = Math.max(MIN_GREEN, cycle - lost - g0);
        g0 = cycle - lost - g1;
        phases.push({ edges: phaseEdges[0], green: Math.max(MIN_GREEN, g0) });
        phases.push({ edges: phaseEdges[1], green: g1 });
      }
      let t = 0;
      for (const p of phases) {
        p.start = t;
        p.baseGreen = p.green;
        t += p.green + YELLOW + ALL_RED;
      }
      const offset = rng.range(0, t);
      const c = {
        id: this.controllers.length,
        nodes: groups.get(g),
        approaches: edges,
        phases,
        cycle: t,
        baseCycle: t,
        offset,
        planStart: -offset, // sim time the running cycle began
        actuated: phaseEdges[1].length > 0,
        demand: phases.map(() => 0),
        x: net.nodeX[g],
        z: net.nodeZ[g],
      };
      this.controllers.push(c);
      phases.forEach((p, pi) => {
        for (const e of p.edges) {
          this.controllerOf[e] = c.id;
          this.phaseOf[e] = pi;
        }
      });
    }
  }

  /** Seconds into a controller's running cycle at sim time `t`. */
  cycleTime(c, t) {
    const tt = t - c.planStart;
    if (tt >= 0 && tt < c.cycle) return tt;
    return ((tt % c.cycle) + c.cycle) % c.cycle;
  }

  /** 'G' | 'Y' | 'R' for traffic at the downstream end of edge e at sim time `t` (seconds). */
  state(e, t) {
    const ci = this.controllerOf[e];
    if (ci < 0) return 'G';
    const c = this.controllers[ci];
    const p = c.phases[this.phaseOf[e]];
    const into = this.cycleTime(c, t) - p.start;
    if (into >= 0 && into < p.green) return 'G';
    if (into >= p.green && into < p.green + YELLOW) return 'Y';
    return 'R';
  }

  /** Seconds until this approach's signal changes. */
  remaining(e, t) {
    const ci = this.controllerOf[e];
    if (ci < 0) return Infinity;
    const c = this.controllers[ci];
    const p = c.phases[this.phaseOf[e]];
    let into = this.cycleTime(c, t) - p.start;
    if (into < 0) into += c.cycle;
    if (into < p.green) return p.green - into;
    if (into < p.green + YELLOW) return p.green + YELLOW - into;
    return c.cycle - into;
  }

  /** Typical green time divided by cycle length for an approach (1 for unsignalized edges). */
  greenShare(e) {
    const ci = this.controllerOf[e];
    if (ci < 0) return 1;
    const c = this.controllers[ci];
    return c.phases[this.phaseOf[e]].baseGreen / c.baseCycle;
  }

  /** Average wait at an otherwise empty approach (Webster's uniform delay with no queue). */
  uniformDelay(e) {
    const ci = this.controllerOf[e];
    if (ci < 0) return 0;
    const c = this.controllers[ci];
    const g = c.phases[this.phaseOf[e]].baseGreen;
    return (c.baseCycle * (1 - g / c.baseCycle) ** 2) / 2;
  }

  /** Count a car crossing an approach's stop line (the actuation detectors). */
  count(e) {
    this.passed[e]++;
  }

  /**
   * Start each controller's next cycle when the running one ends, with greens sized to the
   * demand each phase saw. `traffic` gives the queues; `capScale` cars per simulated car.
   */
  update(now, traffic) {
    for (const c of this.controllers) {
      const tt = now - c.planStart;
      if (tt >= 0 && tt < c.cycle) continue;
      if (tt < 0 || tt > c.cycle * 3) {
        // The clock jumped (new scenario or day): pick up where the running cycle would be.
        c.planStart = now - this.cycleTime(c, now);
        for (const e of c.approaches) this.passed[e] = 0;
        continue;
      }
      c.planStart += c.cycle;
      if (c.actuated) this.replan(c, traffic);
      for (const e of c.approaches) this.passed[e] = 0;
    }
  }

  replan(c, traffic) {
    const net = this.net;
    const scale = traffic.capScale || 1;
    const n = c.phases.length;
    const lost = n * (YELLOW + ALL_RED);
    let want = lost;
    for (let i = 0; i < n; i++) {
      const p = c.phases[i];
      // Critical lane: the approach lane with the most cars through plus cars waiting.
      let crit = 0;
      for (const e of p.edges) {
        const lanes = Math.max(1, net.lanes[e]);
        // Off-ramps carry queue detectors along their whole length (spillback protection).
        const ramp = net.cls[e] === 1 || net.cls[e] === 3;
        const look = ramp ? Math.max(RAMP_LOOK_M, net.len[e]) : LOOK_M;
        let q = 0;
        for (let l = 0; l < lanes; l++) {
          const arr = traffic.laneCars[traffic.laneStart[e] + l];
          if (!arr) continue;
          let k = 0;
          for (const v of arr) {
            if (net.len[e] - v.s > look) break;
            if (v.v < 2) k++;
          }
          if (k > q) q = k;
        }
        // A short approach (OSM splits a road where its turn lanes begin): the rest of the
        // queue stands on the road leading into it.
        const rest = look - net.len[e];
        if (rest > 0) {
          const n0 = net.from[e];
          let up = 0;
          for (let k = net.inStart[n0]; k < net.inStart[n0 + 1]; k++) {
            const pe = net.inEdges[k];
            if (net.from[pe] === net.to[e]) continue;
            for (let l = 0; l < Math.max(1, net.lanes[pe]); l++) {
              const arr = traffic.laneCars[traffic.laneStart[pe] + l];
              if (!arr) continue;
              for (const v of arr) {
                if (net.len[pe] - v.s > rest) break;
                if (v.v < 2 && v.route[v.ri + 1] === e) up++;
              }
            }
          }
          q += up / lanes;
        }
        const d = (this.passed[e] / lanes + q) * (ramp ? RAMP_WEIGHT : 1);
        if (d > crit) crit = d;
      }
      c.demand[i] = c.demand[i] * 0.4 + crit * 0.6;
      p.need = Math.max(MIN_GREEN, START_LOSS + (c.demand[i] * scale) / SAT_FLOW);
      want += p.need;
    }
    // Over two minutes: everyone's extra green shrinks in proportion.
    const squeeze = want > MAX_CYCLE ? (MAX_CYCLE - lost - n * MIN_GREEN) / (want - lost - n * MIN_GREEN) : 1;
    let t = 0;
    for (const p of c.phases) {
      p.green = MIN_GREEN + (p.need - MIN_GREEN) * squeeze;
      p.start = t;
      t += p.green + YELLOW + ALL_RED;
    }
    c.cycle = t;
  }

  /** Controller nearest to (x, z) within `r` meters (for the inspector). */
  nearest(x, z, r = 60) {
    let best = null;
    let bd = r * r;
    for (const c of this.controllers) {
      const d = (c.x - x) ** 2 + (c.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    return best;
  }

  /** {label, remaining} of the phase running now at a controller. */
  describe(c, t) {
    const tt = this.cycleTime(c, t);
    for (let i = 0; i < c.phases.length; i++) {
      const p = c.phases[i];
      const into = tt - p.start;
      const span = p.green + YELLOW + ALL_RED;
      if (into >= 0 && into < span) {
        const label = !p.edges.length ? 'Pedestrian crossing' : i === 0 ? 'Main street' : 'Cross street';
        const state = into < p.green ? 'green' : into < p.green + YELLOW ? 'yellow' : 'all red';
        return { label: `${label} ${state}`, remaining: (into < p.green ? p.green : into < p.green + YELLOW ? p.green + YELLOW : span) - into, cycle: c.cycle };
      }
    }
    return { label: '—', remaining: 0, cycle: c.cycle };
  }
}

// 911 response: fire stations, EMS bases, police and emergency departments from the map, with
// units that actually drive to the scene through live traffic.
//
// A call is handled in the usual stages: call processing (~60 s), turnout at the station (fire
// 80 s and EMS 60 s, the NFPA 1710 benchmarks; police 30 s), then travel with lights and siren.
// The nearest units by drive time are sent: an ambulance plus the closest engine as first
// responder for a medical call, three engines for a structure fire, police + ambulance + engine
// for a crash, the closest patrol car for a police call. Medical patients are then driven to the
// nearest emergency department (the VA is skipped unless asked: veterans only).
//
// Emergency travel times on each road assume units drive ~15% faster than free flow and get
// through only part of any congestion (traffic pulls over): ff / 1.15 * (1 + 0.35 * (c - 1)).

import { CLASS } from './graph.js';

export const RESPONSE = { callProcessing: 60, turnout: { fire: 80, ems: 60, police: 30 } };
const SCENE = { medical: 14 * 60, fire: 30 * 60, crash: 22 * 60, police: 16 * 60 };
const UNIT_TYPE = { fire: 'engine', ems: 'ambulance', police: 'police' };
const UNIT_WORD = { fire: 'Engine', ems: 'Medic', police: 'Unit' };
export const CALL_TYPES = {
  medical: { label: 'Medical emergency', needs: [['ems', 1], ['fire', 1]] },
  fire: { label: 'Structure fire', needs: [['fire', 3]] },
  crash: { label: 'Vehicle crash with injuries', needs: [['police', 1], ['ems', 1], ['fire', 1]] },
  police: { label: 'Police call', needs: [['police', 1]] },
};
// Benchmarks shown next to results (seconds).
export const BENCHMARKS = {
  nfpaEngineTravel: 240, // NFPA 1710: first engine within 4 min of travel, 90% of the time
  nfpaAlsTravel: 480, // NFPA 1710: advanced life support within 8 min of travel
  buncombeEmsGoal: 539, // Buncombe County EMS goal: 8:59 (dispatch to arrival), 90% of calls
  buncombeEmsActual90: 1037, // 2016-2022 actual, 911 call to EMS arrival, 90th percentile (17:17)
};

const fmt = (sec) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export class Emergency {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    this.net = world.net;
    this.router = world.router;
    this.rng = world.rng.fork('emergency');
    this.incidents = [];
    this.nextId = 1;
    this.allowVA = false;
    this.timeBuf = new Float32Array(this.net.nodeCount);
    this.predBuf = new Int32Array(this.net.nodeCount);
    this.weights = new Float32Array(this.net.edgeCount);
    this.buildStations(world.data.pois);
    this.patrols = [];
    this.patrolTarget = 14;
    this.emsFromFire = false;
  }

  buildStations(pois) {
    const net = this.net;
    // Units can't start or end on a freeway.
    const ok = (n) => {
      for (let k = net.outStart[n]; k < net.outStart[n + 1]; k++) {
        const c = net.cls[net.outEdges[k]];
        if (c !== CLASS.MOTORWAY && c !== CLASS.MOTORWAY_LINK && c !== CLASS.TRUNK_LINK) return true;
      }
      return false;
    };
    const nodeFor = (p) => (p.node != null && ok(p.node) ? p.node : net.nearestNode(p.x, p.z, ok));
    this.stations = [];
    let id = 1;
    const digits = (s) => (String(s).match(/(\d+(?:-\d+)?)/) || [])[1];
    for (const p of pois) {
      if (p.kind !== 'fire' && p.kind !== 'ems' && p.kind !== 'police') continue;
      const kind = p.kind;
      const node = nodeFor(p);
      if (node < 0) continue;
      const num = digits(p.name);
      const st = { id: id++, kind, name: p.name, node, x: p.x, z: p.z, approx: !!p.approx, poi: p, units: [] };
      const count = kind === 'police' ? 1 : 1;
      for (let u = 0; u < count; u++) {
        st.units.push({ id: `${kind}-${st.id}-${u}`, kind, label: `${UNIT_WORD[kind]} ${num || st.id}`, busy: false, station: st });
      }
      this.stations.push(st);
    }
    // EMS bases are mostly co-located with fire stations; until the map has them, use those.
    if (!this.stations.some((s) => s.kind === 'ems')) {
      this.emsFromFire = true;
      for (const f of this.stations.filter((s) => s.kind === 'fire')) {
        const st = { id: id++, kind: 'ems', name: `${f.name} (EMS, assumed co-located)`, node: f.node, x: f.x, z: f.z, approx: true, units: [] };
        st.units.push({ id: `ems-${st.id}-0`, kind: 'ems', label: `Medic ${digits(f.name) || st.id}`, busy: false, station: st });
        this.stations.push(st);
      }
    }
    this.hospitals = pois.filter((p) => p.kind === 'hospital').map((p) => ({ ...p, node: nodeFor(p) })).filter((h) => h.node >= 0);
    this.eds = () => this.hospitals.filter((h) => h.sub === 'ed' || (this.allowVA && h.sub === 'va'));
  }

  /** Travel time weights for emergency vehicles. */
  emergencyWeights(live = true) {
    const net = this.net;
    const w = this.weights;
    const c = this.world.traffic.congestion;
    for (let e = 0; e < net.edgeCount; e++) {
      const base = net.ffTime[e] / 1.15;
      w[e] = live ? base * (1 + 0.35 * (c[e] - 1)) : base;
    }
    return w;
  }

  /** Accessible node nearest a clicked point. */
  nodeAt(x, z) {
    const net = this.net;
    return net.nearestNode(x, z, (n) => {
      for (let k = net.outStart[n]; k < net.outStart[n + 1]; k++) {
        const cl = net.cls[net.outEdges[k]];
        if (cl !== CLASS.MOTORWAY && cl !== CLASS.MOTORWAY_LINK) return true;
      }
      return false;
    });
  }

  /**
   * Seconds from the 911 call until the first unit of `kind` could arrive at every node.
   * kind: 'fire' | 'ems' | 'police' | 'hospital' (time to drive to the nearest ED instead).
   * extra: node ids of hypothetical stations for what-if planning.
   */
  responseTimes(kind, { live = false, extra = [], out = null } = {}) {
    const w = this.emergencyWeights(live);
    const res = out || new Float32Array(this.net.nodeCount);
    if (kind === 'hospital') {
      const eds = this.eds().map((h) => h.node).concat(extra);
      this.router.dijkstra(eds, live ? this.world.liveWeights() : this.net.ffTime, { reverse: true, out: res });
      return res;
    }
    // 'medical' = whoever gets there first, a fire engine or an ambulance (both carry medical crews).
    const kinds = kind === 'medical' ? ['fire', 'ems'] : [kind];
    const t0Of = (k) => RESPONSE.callProcessing + (RESPONSE.turnout[k] ?? 60);
    const sources = this.stations.filter((s) => kinds.includes(s.kind)).map((s) => ({ node: s.node, t0: t0Of(s.kind) }));
    // Hypothetical stations: node ids, or {node, kind} objects.
    for (const n of extra) {
      const node = typeof n === 'number' ? n : n.node;
      const k = typeof n === 'number' || !kinds.includes(n.kind) ? kinds[0] : n.kind;
      if (node >= 0) sources.push({ node, t0: t0Of(k) });
    }
    this.router.dijkstra(sources, w, { out: res });
    return res;
  }

  /**
   * Report a 911 call at (x, z). Returns the incident, already dispatched.
   * @param {{type: 'medical'|'fire'|'crash'|'police', x: number, z: number}} o
   */
  call({ type = 'medical', x, z }) {
    const world = this.world;
    const now = world.time;
    const spec = CALL_TYPES[type] || CALL_TYPES.medical;
    const node = this.nodeAt(x, z);
    const inc = {
      id: this.nextId++, type, label: spec.label, x, z, node, created: now, status: 'dispatching', units: [], timeline: [],
      firstArrivalSec: null, responseSec: null, emsArrivalSec: null, hospital: null, transport: null, transportEtaSec: null, transportSec: null, closedSec: null,
      emsFromFire: this.emsFromFire,
    };
    inc.timeline.push({ t: now, label: '911 call received' });
    // Drive times from every node to the scene (reverse search), with live traffic.
    const w = this.emergencyWeights(true);
    const T = this.router.dijkstra([node], w, { reverse: true, out: new Float32Array(this.net.nodeCount), pred: new Int32Array(this.net.nodeCount) });
    inc._T = T;
    for (const [kind, count] of spec.needs) {
      const picks = this.pickUnits(kind, count, T, now);
      for (const pk of picks) {
        const u = pk.unit;
        u.busy = true;
        inc.units.push({
          kind, label: u.label, station: pk.from, unit: u, vehicle: pk.vehicle || null, etaSec: pk.eta, patrol: !!pk.vehicle,
          dispatchAt: now + RESPONSE.callProcessing, departAt: now + RESPONSE.callProcessing + (pk.vehicle ? 0 : RESPONSE.turnout[kind]),
          departed: false, arrived: null, startNode: pk.node,
        });
      }
    }
    if (inc.units.length) {
      const names = inc.units.map((u) => `${u.label} (${u.station})`).join(', ');
      inc.timeline.push({ t: now + RESPONSE.callProcessing, label: `Dispatched: ${names}`, pending: true });
    }
    this.incidents.push(inc);
    return inc;
  }

  pickUnits(kind, count, T, now) {
    const cand = [];
    const turnout = RESPONSE.turnout[kind];
    for (const st of this.stations) {
      if (st.kind !== kind) continue;
      const t = T[st.node];
      if (!(t < Infinity)) continue;
      for (const u of st.units) if (!u.busy) cand.push({ unit: u, from: st.name, node: st.node, eta: RESPONSE.callProcessing + turnout + t });
    }
    if (kind === 'police') {
      // Roaming patrol cars: no turnout, already rolling.
      for (const p of this.patrols) {
        const v = p.vehicle;
        if (!v || v.dead || v.leaving || p.unit.busy) continue;
        const n = this.net.to[v.edge];
        const t = T[n] + (this.net.len[v.edge] - v.s) / Math.max(5, v.v);
        if (t < Infinity) cand.push({ unit: p.unit, from: 'on patrol', node: n, vehicle: v, eta: RESPONSE.callProcessing + t, patrol: p });
      }
    }
    cand.sort((a, b) => a.eta - b.eta);
    // Several units at one station count as separate picks; keep stations distinct for fires.
    const out = [];
    const used = new Set();
    for (const c of cand) {
      if (out.length >= count) break;
      if (kind === 'fire' && used.has(c.from)) continue;
      used.add(c.from);
      out.push(c);
    }
    return out;
  }

  /** Called every simulation step. */
  update(dt, now) {
    this.maintainPatrols(now);
    for (const inc of this.incidents) {
      if (inc.status === 'closed') continue;
      for (const u of inc.units) {
        if (!u.departed && now >= u.departAt) this.depart(inc, u, now);
      }
      if (inc.status === 'transporting' || inc.status === 'closed') continue;
      if (inc.units.length && inc.units.every((u) => u.arrived !== null)) {
        if (inc.status !== 'on scene') {
          inc.status = 'on scene';
          inc.sceneUntil = now + (SCENE[inc.type] || 900);
        }
      }
      if (inc.status === 'on scene' && now >= inc.sceneUntil) this.finishScene(inc, now);
    }
    // Close incidents whose transport finished long ago; keep the list short.
    if (this.incidents.length > 40) this.incidents = this.incidents.filter((i) => i.status !== 'closed' || now - (i.closedAt || now) < 3600);
  }

  depart(inc, u, now) {
    u.departed = true;
    const world = this.world;
    const w = this.emergencyWeights(true);
    if (u.vehicle && !u.vehicle.dead && !u.vehicle.leaving) {
      // Patrol car turns on its lights and heads over from where it is.
      const v = u.vehicle;
      const from = this.net.to[v.edge];
      const r = this.router.route(from, inc.node, w, { maxSpeed: this.net.maxSpeed * 1.3 });
      if (r) {
        world.traffic.reroute(v, r.edges);
        v.siren = true;
        v.purpose = 'emergency';
        v.onRouteEnd = null;
        v.holdOnArrival = true;
        v.emUnit = { inc, u };
        inc.timeline.push({ t: now, label: `${u.label} responding from patrol (expected on scene ${fmt(u.etaSec)} after the call)` });
        return;
      }
    }
    const r = this.router.route(u.startNode, inc.node, w, { maxSpeed: this.net.maxSpeed * 1.3 });
    if (!r || !r.edges.length) {
      u.arrived = now;
      inc.timeline.push({ t: now, label: `${u.label} was already at the scene` });
      return;
    }
    const v = world.traffic.spawn({ route: r.edges, purpose: 'emergency', type: UNIT_TYPE[u.kind], siren: true, force: true, startS: 2,
      destS: this.net.len[r.edges[r.edges.length - 1]] }, now);
    if (!v) return;
    v.holdOnArrival = true;
    v.emUnit = { inc, u };
    v.fade = 1;
    v.fadeDir = 0;
    u.vehicle = v;
    inc.status = 'en route';
    inc.timeline.push({ t: now, label: `${u.label} en route from ${u.station} (expected on scene ${fmt(u.etaSec)} after the call)` });
  }

  /** A responding vehicle reached the scene (traffic's arrival hook). */
  onArrive(v, now) {
    const em = v.emUnit;
    if (!em) return;
    const { inc, u } = em;
    if (em.transport) {
      inc.transportSec = now - em.transportStart;
      if (inc.transport) inc.transport.arrived = true;
      inc.status = 'closed';
      inc.closedAt = now;
      inc.closedSec = now - inc.created;
      inc.timeline.push({ t: now, label: `Arrived at ${inc.hospital?.name}: ${fmt(inc.closedSec)} after the call` });
      this.world.traffic.release(v);
      u.unit.busy = false;
      return;
    }
    u.arrived = now;
    const since = now - inc.created;
    if (inc.firstArrivalSec === null) {
      inc.firstArrivalSec = since;
      inc.responseSec = since;
    }
    if (u.kind === 'ems' && inc.emsArrivalSec === null) inc.emsArrivalSec = since;
    inc.timeline.push({ t: now, label: `${u.label} on scene: ${fmt(since)} after the call` });
  }

  finishScene(inc, now) {
    const world = this.world;
    const amb = inc.units.find((u) => u.kind === 'ems');
    for (const u of inc.units) {
      if (u === amb && inc.type !== 'police') continue;
      if (u.vehicle && u.vehicle.onScene) world.traffic.release(u.vehicle);
      u.unit.busy = false;
    }
    if (amb && amb.vehicle && (inc.type === 'medical' || inc.type === 'crash')) {
      // Drive the patient to the nearest emergency department (by emergency drive time).
      const w = this.emergencyWeights(true);
      let best = null;
      for (const h of this.eds()) {
        const r = this.router.route(inc.node, h.node, w, { maxSpeed: this.net.maxSpeed * 1.3 });
        if (r && (!best || r.time < best.r.time)) best = { h, r };
      }
      if (best && best.r.edges.length) {
        world.traffic.release(amb.vehicle);
        const v = world.traffic.spawn({ route: best.r.edges, purpose: 'emergency', type: 'ambulance', siren: true, force: true, startS: 1,
          destS: this.net.len[best.r.edges[best.r.edges.length - 1]] }, now);
        if (v) {
          v.fade = 1;
          v.fadeDir = 0;
          v.holdOnArrival = true;
          v.emUnit = { inc, u: amb, transport: true, transportStart: now };
          amb.vehicle = v;
          inc.hospital = { name: best.h.name, node: best.h.node, x: best.h.x, z: best.h.z, sub: best.h.sub };
          inc.transport = { route: best.r.edges, arrived: false, vehicle: v };
          inc.transportEtaSec = best.r.time;
          inc.status = 'transporting';
          inc.timeline.push({ t: now, label: `Transporting to ${best.h.name} (about ${Math.round(best.r.time / 60)} min)` });
          return;
        }
      }
    }
    if (amb && amb.vehicle && amb.vehicle.onScene) world.traffic.release(amb.vehicle);
    if (amb) amb.unit.busy = false;
    inc.status = 'closed';
    inc.closedAt = now;
    inc.closedSec = now - inc.created;
    inc.timeline.push({ t: now, label: 'Units clear the scene' });
  }

  // --- Patrol cars ---------------------------------------------------------------------------

  maintainPatrols(now) {
    if (this.patrolTarget <= 0) return;
    const police = this.stations.filter((s) => s.kind === 'police');
    if (!police.length) return;
    // Spawn at most one patrol per step until the target is met.
    const alive = this.patrols.filter((p) => p.vehicle && !p.vehicle.dead && !p.vehicle.leaving);
    if (alive.length >= this.patrolTarget) return;
    const idx = this.patrols.length % police.length;
    const home = police[(idx * 7) % police.length];
    const unit = { id: `patrol-${this.patrols.length + 1}`, kind: 'police', label: `Patrol ${this.patrols.length + 1}`, busy: false };
    const p = { unit, home, vehicle: null };
    const v = this.spawnPatrolLeg(p, home.node, now);
    if (v) this.patrols.push(p);
  }

  randomNear(node, radius) {
    const net = this.net;
    const x = net.nodeX[node] + (this.rng.next() * 2 - 1) * radius;
    const z = net.nodeZ[node] + (this.rng.next() * 2 - 1) * radius;
    return this.nodeAt(x, z);
  }

  spawnPatrolLeg(p, from, now) {
    const to = this.randomNear(p.home.node, 5000);
    if (to < 0 || to === from) return null;
    const r = this.router.routeALT(from, to, this.world.routingWeights());
    if (!r || !r.edges.length) return null;
    const v = this.world.traffic.spawn({ route: r.edges, purpose: 'patrol', type: 'police', siren: false, force: true }, now);
    if (!v) return null;
    p.vehicle = v;
    v.patrolRef = p;
    v.onRouteEnd = (veh) => {
      const dest = this.randomNear(p.home.node, 5000);
      const start = this.net.to[veh.edge];
      if (dest < 0 || dest === start) return null;
      const rr = this.router.routeALT(start, dest, this.world.routingWeights());
      return rr ? rr.edges : null;
    };
    return v;
  }
}

// Who drives where, and when. Trips come from real data where it exists and from
// well-documented travel-behavior patterns where it doesn't:
//
//   commutes      LEHD LODES 2023 home-block -> work-block flows; departure times from each
//                 block group's ACS "time leaving home" table; work-from-home, transit and
//                 carpooling from ACS means of transportation.
//   school runs   each block's students go to their zoned schools (county attendance districts)
//                 or nearby charter/private schools; some are driven, some ride yellow buses,
//                 some teens drive themselves.
//   errands       shopping, services, medical and social tours from every home, toward places
//                 with retail/service jobs, with a gravity model (closer places more likely)
//                 and a national (NHTS) time-of-day profile.
//   visitors      hotel and vacation-rental guests and day-trippers touring Biltmore, downtown,
//                 the River Arts District, the Blue Ridge Parkway...; regional drivers coming in
//                 from neighboring counties to shop and see doctors.
//   freight       vans, box trucks and tractor-trailers between commercial buildings.
//   through       interstate traffic passing through on I-26 and I-40.
//   events        ballgames, concerts and holiday light shows with arrival and departure waves.
//
// Everything scales with the scenario's multipliers and the user's demand slider.

import { clamp } from './constants.js';
import { KIND } from '../data/worldData.js';

// --- Time-of-day profiles (share of starts per hour, normalized at load) --------------------
const PROFILE = {
  other: {
    weekday: [0.3, 0.15, 0.1, 0.1, 0.15, 0.5, 1.6, 3.6, 5.2, 6.4, 7.3, 7.9, 8.3, 7.9, 7.5, 7.8, 8.1, 7.8, 6.5, 4.8, 3.4, 2.2, 1.2, 0.6],
    saturday: [0.5, 0.3, 0.2, 0.1, 0.1, 0.3, 0.8, 2.0, 4.0, 6.5, 8.5, 9.5, 9.6, 9.3, 8.8, 8.3, 7.6, 6.8, 5.6, 4.4, 3.3, 2.4, 1.5, 0.9],
    sunday: [0.5, 0.3, 0.2, 0.1, 0.1, 0.2, 0.6, 1.8, 4.5, 7.2, 8.0, 8.6, 9.2, 8.8, 8.2, 7.6, 7.0, 6.4, 5.4, 4.2, 3.0, 2.0, 1.2, 0.7],
  },
  freight: [0.4, 0.3, 0.3, 0.4, 0.8, 2.2, 5.0, 7.4, 8.4, 8.6, 8.6, 8.2, 7.6, 7.8, 7.8, 7.2, 6.0, 4.2, 2.6, 1.8, 1.4, 1.0, 0.7, 0.5],
  through: [1.2, 0.9, 0.8, 0.8, 1.0, 1.8, 3.2, 4.6, 5.2, 5.4, 5.6, 5.8, 5.8, 5.8, 5.9, 6.0, 6.0, 5.8, 5.0, 4.2, 3.4, 2.8, 2.2, 1.6],
};
for (const k of ['weekday', 'saturday', 'sunday']) PROFILE.other[k] = normalize(PROFILE.other[k]);
PROFILE.freight = normalize(PROFILE.freight);
PROFILE.through = normalize(PROFILE.through);

function normalize(a) {
  const s = a.reduce((x, y) => x + y, 0);
  return a.map((x) => x / s);
}

/** ACS B08302 bins (hours since midnight). The first bin is mostly pre-dawn shift starts. */
const LEAVE_BINS = [[3.5, 5], [5, 5.5], [5.5, 6], [6, 6.5], [6.5, 7], [7, 7.5], [7.5, 8], [8, 8.5], [8.5, 9], [9, 10], [10, 11], [11, 12], [12, 16], [16, 23]];

// Share of a day's workers who drive to work, by day type (vacation, sick days, part-time
// schedules and weekends off).
const WORK_TODAY = { weekday: 0.85, saturday: 0.22, sunday: 0.14, holiday: 0.25 };
// Non-work tours per resident per day (each tour = trip out + trip home).
const TOURS_PP = { weekday: 0.66, saturday: 0.74, sunday: 0.56, holiday: 0.62 };

// Through traffic on the interstates (vehicles/day, both directions), and regional tours
// from neighboring counties per corridor. Tuned so simulated daily volumes at the county
// line match NCDOT AADT counts (see scripts/headless.js and data/typical_summary.json).
export const THROUGH = [
  ['i40w', 'i40e', 5000], ['i26e', 'i26n', 5000], ['i26e', 'i40w', 8000], ['i26e', 'i40e', 2800],
  ['i26n', 'i40w', 1200], ['i26n', 'i40e', 900], ['us19w', 'i26e', 900], ['us74a', 'i26e', 400],
];
export const REGIONAL = { i26e: 17000, us25s: 3000, nc191: 2600, i40w: 14000, us19w: 3200, nc63: 600, i26n: 6200, us25n: 1100, nc197: 450, i40e: 5200, us74a: 1100 };
// LODES assigns many jobs to a company's headquarters county, so flows to and from distant
// counties (Charlotte, Raleigh...) are mostly not daily drives. Neighboring counties count in
// full, distant ones at 20%; these are the resulting shares per corridor (in = commuting into
// Buncombe, out = commuting out).
const COMMUTE_REALISM = {
  i26e: { in: 0.648, out: 0.669 }, i26n: { in: 0.738, out: 0.813 }, i40e: { in: 0.345, out: 0.245 }, i40w: { in: 0.774, out: 0.881 },
  us19w: { in: 0.681, out: 0.748 }, us74a: { in: 0.78, out: 0.697 }, us25s: { in: 0.977, out: 1 }, nc197: { in: 0.853, out: 0.82 },
};
// Asheville Regional Airport (just over the county line in Fletcher): about 2.2 million
// passengers a year; drop-offs and pick-ups both count.
const AIRPORT_TRIPS = 5200;
// Day-trip visitors arrive by corridor (share).
const DAYTRIP_CORRIDORS = { i26e: 0.32, i40e: 0.28, i40w: 0.16, i26n: 0.1, us74a: 0.06, us19w: 0.05, us25s: 0.03 };
const EVENT_CORRIDORS = { i26e: 0.38, i40w: 0.2, i40e: 0.14, i26n: 0.14, us19w: 0.08, us25s: 0.06 };

// Attraction of a building for errands and leisure, per job (or per 200 m^2 when jobless).
const ATTRACT = new Float32Array(32).fill(0.2);
ATTRACT[KIND.RETAIL] = 3.2;
ATTRACT[KIND.MIXED_USE] = 2.4;
ATTRACT[KIND.COMMERCIAL] = 1.4;
ATTRACT[KIND.MEDICAL] = 2.2;
ATTRACT[KIND.HOSPITAL] = 0.5;
ATTRACT[KIND.OFFICE] = 0.5;
ATTRACT[KIND.HOTEL] = 0.9;
ATTRACT[KIND.RECREATION] = 2.5;
ATTRACT[KIND.CIVIC] = 1.2;
ATTRACT[KIND.CHURCH] = 0.8;
ATTRACT[KIND.SCHOOL] = 0.25;
ATTRACT[KIND.UNIVERSITY] = 0.5;
ATTRACT[KIND.GOVERNMENT] = 0.8;
ATTRACT[KIND.INDUSTRIAL] = 0.1;
ATTRACT[KIND.WAREHOUSE] = 0.15;

// Tourist destinations (poi venue ids) and their pull on a normal day.
const DISTRICTS = new Set(['downtown', 'rad', 'biltmore_village', 'biltmore_park', 'asheville_mall', 'outlets']);
// Biltmore: ~1.4 million visitors a year (~1,900 cars on an October day) out of ~1.5 attraction
// stops per visitor party per day.
const TOURIST_SPOTS = {
  downtown: 0.26, biltmore: 0.085, rad: 0.09, biltmore_village: 0.04, grove_park: 0.05, arboretum: 0.06, folk_art: 0.04,
  craggy: 0.03, brp_vc: 0.03, asheville_mall: 0.05, outlets: 0.06, biltmore_park: 0.04, wnc_nature: 0.03,
};

/** Cumulative-weight sampler over a typed array of weights. */
class Sampler {
  constructor(weights, items = null) {
    const n = weights.length;
    this.cum = new Float64Array(n);
    let acc = 0;
    for (let i = 0; i < n; i++) {
      acc += Math.max(0, weights[i]);
      this.cum[i] = acc;
    }
    this.total = acc;
    this.items = items;
  }

  sample(r) {
    if (this.total <= 0) return -1;
    const x = r * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return this.items ? this.items[lo] : lo;
  }
}

/** Per-group (block, block group) samplers over buildings, stored as one CSR. */
class GroupSampler {
  constructor(groupOf, weights, groups) {
    const n = groupOf.length;
    const start = new Int32Array(groups + 1);
    for (let i = 0; i < n; i++) start[groupOf[i] + 1]++;
    for (let g = 0; g < groups; g++) start[g + 1] += start[g];
    const items = new Int32Array(n);
    const fill = start.slice(0, groups);
    for (let i = 0; i < n; i++) items[fill[groupOf[i]]++] = i;
    const cum = new Float64Array(n);
    for (let g = 0; g < groups; g++) {
      let acc = 0;
      for (let k = start[g]; k < start[g + 1]; k++) {
        acc += Math.max(0, weights[items[k]]);
        cum[k] = acc;
      }
    }
    this.start = start;
    this.items = items;
    this.cum = cum;
  }

  total(g) {
    const a = this.start[g];
    const b = this.start[g + 1];
    return b > a ? this.cum[b - 1] : 0;
  }

  /** Building in group g by weight; falls back to a uniform pick when all weights are zero. */
  sample(g, r) {
    const a = this.start[g];
    const b = this.start[g + 1];
    if (b <= a) return -1;
    const tot = this.cum[b - 1];
    if (tot <= 0) return this.items[a + Math.floor(r * (b - a))];
    const x = r * tot;
    let lo = a;
    let hi = b - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return this.items[lo];
  }
}

function poisson(lambda, rng) {
  if (lambda <= 0) return 0;
  if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.normal()));
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.next();
  } while (p > L);
  return k - 1;
}

export class TripMaker {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    const data = world.data;
    this.data = data;
    this.net = data.roads;
    this.rng = world.rng.fork('demand');
    const b = data.buildings;
    const nb = b.count;
    const blocks = data.areas.block.geoid.length;
    const bgs = data.areas.bg.geoid.length;

    // Weights per building.
    const res = new Float32Array(nb);
    const jobs = new Float32Array(nb);
    const kids = new Float32Array(nb);
    const attract = new Float32Array(nb);
    const freight = new Float32Array(nb);
    for (let i = 0; i < nb; i++) {
      res[i] = b.residents[i];
      jobs[i] = b.jobs[i];
      kids[i] = b.kids10[i] / 10;
      const k = b.kind[i];
      const base = b.jobs[i] > 0 ? b.jobs[i] : b.area[i] / 200;
      attract[i] = ATTRACT[k] * base + (b.households[i] > 0 ? b.households[i] * 0.04 : 0);
      if (k === KIND.RETAIL || k === KIND.COMMERCIAL || k === KIND.INDUSTRIAL || k === KIND.WAREHOUSE || k === KIND.MIXED_USE
        || k === KIND.HOSPITAL || k === KIND.MEDICAL || k === KIND.HOTEL) freight[i] = b.jobs[i] * (k === KIND.WAREHOUSE || k === KIND.INDUSTRIAL ? 2 : 1);
    }
    this.weights = { res, jobs, kids, attract, freight };
    this.byBlockRes = new GroupSampler(b.block, res, blocks);
    this.byBlockJobs = new GroupSampler(b.block, jobs, blocks);
    this.byBlockKids = new GroupSampler(b.block, kids, blocks);
    this.byBlockAny = new GroupSampler(b.block, b.area, blocks);
    this.byBgAttract = new GroupSampler(b.bg, attract, bgs);
    this.allRes = new Sampler(res);
    this.allFreight = new Sampler(freight);
    this.totalResidents = this.allRes.total;

    // Gravity table: origin block group -> destination block group for errands.
    const centers = data.areas.bg.center;
    const A = new Float64Array(bgs);
    for (let g = 0; g < bgs; g++) A[g] = this.byBgAttract.total(g);
    this.bgCenters = centers;
    this.bgAttract = A;
    this.bgAnyAttract = new Sampler(A);
    this.gravity = [];
    for (let o = 0; o < bgs; o++) {
      const w = new Float64Array(bgs);
      for (let d = 0; d < bgs; d++) {
        const km = Math.hypot(centers[o][0] - centers[d][0], centers[o][1] - centers[d][1]) / 1000;
        // Mostly local errands with a long tail (Asheville Mall, downtown, the big-box strips).
        w[d] = A[d] * (Math.exp(-km / 3.2) + 0.12 * Math.exp(-km / 14));
      }
      this.gravity.push(new Sampler(w));
    }

    // Commute mode shares per block group, and a county-wide fallback.
    const modes = data.areas.bg.mode;
    this.vehShare = new Float32Array(bgs);
    let s = 0;
    for (let g = 0; g < bgs; g++) {
      const m = modes[g];
      this.vehShare[g] = clamp((m.drive_alone ?? 0.75) + (m.carpool ?? 0.09) / 2, 0.3, 0.97);
      s += this.vehShare[g];
    }
    this.vehShareCounty = s / bgs;
    // Departure-time samplers per block group, and county-wide.
    const leave = data.areas.bg.leave_time;
    this.leave = leave.map((bins) => new Sampler(bins));
    const county = new Array(14).fill(0);
    for (const bins of leave) bins.forEach((v, i) => (county[i] += v));
    this.leaveCounty = new Sampler(county);

    // Places.
    const pois = data.pois;
    this.venue = {};
    for (const p of pois) if (p.kind === 'venue' && p.id) this.venue[p.id] = p;
    this.parking = pois.filter((p) => p.kind === 'parking');
    this.hotels = pois.filter((p) => p.kind === 'hotel');
    this.breweries = pois.filter((p) => p.kind === 'brewery');
    let rooms = this.hotels.reduce((acc, h) => acc + (h.rooms || 40), 0);
    // Explore Asheville: just under 10,000 hotel rooms on an average night (2025).
    this.roomScale = rooms > 0 ? 9800 / rooms : 1;
    this.hotelSampler = new Sampler(this.hotels.map((h) => (h.rooms || 40)));
    // Vacation rentals: homes in block groups where many homes are second/seasonal homes.
    const seasonal = data.areas.bg.pct_seasonal || [];
    const str = new Float32Array(nb);
    for (let i = 0; i < nb; i++) {
      if (b.households[i] > 0 || b.units[i] > 0) str[i] = b.units[i] * (0.02 + (seasonal[b.bg[i]] || 0));
    }
    this.strSampler = new Sampler(str);
    this.corridorIndex = {};
    data.demand.corridors.forEach((c, i) => (this.corridorIndex[c.id] = i));

    // School nodes.
    this.schools = data.demand.schools.map((s0, i) => {
      const p = pois.find((q) => q.kind === 'school' && q.school_index === i);
      const node = p ? p.node : this.net.nearestNode(s0.x, s0.z);
      return { ...s0, node, poi: p };
    });
    this.schoolFlowsBySchool = new Map();
    const dm = data.demand;
    for (let k = 0; k < dm.schSchool.length; k++) {
      const si = dm.schSchool[k];
      if (!this.schoolFlowsBySchool.has(si)) this.schoolFlowsBySchool.set(si, []);
      this.schoolFlowsBySchool.get(si).push(k);
    }

    // Corridor ends must connect to the county network in the right direction (entry nodes
    // reach it, exit nodes are reached from it); a few gateways sit on road fragments that only
    // touch the buffer zone, so those move to the nearest node that does connect.
    const net = this.net;
    const hub = data.focus ? data.focus.node : net.nearestNode(0, 0);
    const toHub = world.router.dijkstra([hub], net.ffTime, { reverse: true });
    const fromHub = world.router.dijkstra([hub], net.ffTime);
    const core = net.strongCore();
    const fix = (n, enter) => {
      const ok = enter ? toHub[n] < Infinity : fromHub[n] < Infinity;
      if (ok) return n;
      return net.nearestNode(net.nodeX[n], net.nodeZ[n], (i) => core[i] && net.nodeRank[i] >= 4);
    };
    this.corridors = data.demand.corridors.map((c) => ({ ...c, enter: c.enter.map((n) => fix(n, true)), exit: c.exit.map((n) => fix(n, false)) }));
    this.queue = []; // schedule entries for today, sorted by time
    this.cursor = 0;
    this.streams = null;
    this.departuresByBin = new Float32Array(144);
  }

  // --- Helpers ---------------------------------------------------------------------------------

  nodeOfBuilding(i) {
    return this.data.buildings.node[i];
  }

  corridorNode(ci, enter) {
    const c = this.corridors[ci];
    const list = enter ? c.enter : c.exit;
    return list[Math.floor(this.rng.next() * list.length)];
  }

  pickCorridor(table) {
    const ids = Object.keys(table);
    const id = this.rng.weighted(ids, ids.map((k) => table[k]));
    return this.corridorIndex[id] ?? 0;
  }

  homeIn(block) {
    let i = this.byBlockRes.sample(block, this.rng.next());
    if (i < 0 || this.weights.res[i] <= 0) i = this.byBlockAny.sample(block, this.rng.next());
    return i;
  }

  workIn(block) {
    let i = this.byBlockJobs.sample(block, this.rng.next());
    if (i < 0 || this.weights.jobs[i] <= 0) i = this.byBlockAny.sample(block, this.rng.next());
    return i;
  }

  /** Straight-line travel-time estimate (s) between nodes, for scheduling only. */
  est(o, d) {
    const net = this.net;
    const km = Math.hypot(net.nodeX[o] - net.nodeX[d], net.nodeZ[o] - net.nodeZ[d]) / 1000;
    return 90 + km * 1.35 * 60 / 0.85; // ~1.35 road km per straight km at ~51 km/h
  }

  leaveTime(sampler) {
    const bin = LEAVE_BINS[sampler.sample(this.rng.next())] || LEAVE_BINS[6];
    return (bin[0] + (bin[1] - bin[0]) * this.rng.next()) * 3600;
  }

  addSchedule(t, trip) {
    this.queue.push(t, trip);
  }

  /**
   * Where a visitor heading to a venue actually stops: districts (downtown, the River Arts
   * District, Biltmore Village...) spread arrivals over their parking decks and busiest
   * buildings; single places use their own entrance.
   */
  spotNode(venue, leaving = false) {
    if (!venue) return -1;
    if (venue.id === 'biltmore' && leaving) {
      // Estate visitors leave by the exit road onto Hendersonville Road (US 25), not back
      // through the Biltmore Village gate.
      if (this._biltmoreExit == null) {
        const net = this.net;
        this._biltmoreExit = net.nearestNode(venue.x, venue.z + 400, (i) => net.nodeRank[i] >= 6 && net.strongCore()[i]);
      }
      return this._biltmoreExit;
    }
    if (!DISTRICTS.has(venue.id)) return venue.node;
    let list = this._spotCache?.get(venue.id);
    if (!list) {
      const b = this.data.buildings;
      const nodes = [];
      const w = [];
      for (const p of this.parking) {
        if (Math.hypot(p.x - venue.x, p.z - venue.z) < 750) {
          nodes.push(p.node);
          w.push(Math.max(80, p.capacity || 200) * 6);
        }
      }
      b.forEachNear(venue.x, venue.z, venue.id === 'downtown' ? 700 : 500, (i) => {
        if (this.weights.attract[i] > 0.5) {
          nodes.push(b.node[i]);
          w.push(this.weights.attract[i]);
        }
      });
      if (!nodes.length) {
        nodes.push(venue.node);
        w.push(1);
      }
      list = new Sampler(w, nodes);
      if (!this._spotCache) this._spotCache = new Map();
      this._spotCache.set(venue.id, list);
    }
    return list.sample(this.rng.next());
  }

  /** Destination building for an errand from origin block group `bg`. */
  errandDestination(bg) {
    const dbg = this.gravity[bg].sample(this.rng.next());
    return this.byBgAttract.sample(dbg, this.rng.next());
  }

  /** Nearest block group to a point (for gateways and venues). */
  bgNear(x, z) {
    let best = 0;
    let bd = Infinity;
    const c = this.bgCenters;
    for (let g = 0; g < c.length; g++) {
      const d = (c[g][0] - x) ** 2 + (c[g][1] - z) ** 2;
      if (d < bd) {
        bd = d;
        best = g;
      }
    }
    return best;
  }

  // --- The day's schedule ------------------------------------------------------------------------

  /**
   * Build today's scheduled trips (commutes, school, events, first legs of visitor tours) and
   * the rates for streaming trips (errands, freight, through, regional).
   * @param {import('./clock.js').Clock} clock
   * @param {object} sc scenario
   * @param {number} demand user demand multiplier
   */
  startDay(clock, sc, demand) {
    const rng = this.rng;
    const data = this.data;
    const b = data.buildings;
    const mult = sc.mult || {};
    const dayType = sc.dayType || clock.dayType;
    const weather = this.world.weather.demandFactor();
    this.queue = [];
    this.cursor = 0;
    this.departuresByBin.fill(0);
    const sched = [];
    const add = (t, trip) => {
      if (t < 0 || t >= 86400) return;
      trip.tDep = t;
      sched.push(trip);
      this.departuresByBin[Math.floor(t / 600)]++;
    };

    // --- Commutes (LODES) ---
    const dm = data.demand;
    const pWork = (WORK_TODAY[dayType] ?? 0.85) * (mult.commute ?? 1) * demand * weather;
    let commuters = 0;
    for (let k = 0; k < dm.odHome.length; k++) {
      const h = dm.odHome[k];
      const w = dm.odWork[k];
      const bgShare = h >= 0 ? this.vehShare[data.areas.block.bg[h]] : this.vehShareCounty;
      let real = 1;
      if (h < 0) real = COMMUTE_REALISM[this.corridors[-1 - h].id]?.in ?? 1;
      else if (w < 0) real = COMMUTE_REALISM[this.corridors[-1 - w].id]?.out ?? 1;
      const x = dm.odCount[k] * pWork * bgShare * real;
      let nInst = Math.floor(x);
      if (rng.next() < x - nInst) nInst++;
      for (let q = 0; q < nInst; q++) {
        let homeB = -1;
        let workB = -1;
        let o;
        let d;
        let t1;
        if (h >= 0) {
          homeB = this.homeIn(h);
          if (homeB < 0) continue;
          o = b.node[homeB];
          t1 = this.leaveTime(this.leave[data.areas.block.bg[h]]);
        } else {
          o = this.corridorNode(-1 - h, true);
          t1 = this.leaveTime(this.leaveCounty) + 900; // already partway here
        }
        if (w >= 0) {
          workB = this.workIn(w);
          if (workB < 0) continue;
          d = b.node[workB];
        } else {
          d = this.corridorNode(-1 - w, false);
        }
        if (o === d) continue;
        const travel = this.est(o, d);
        const evening = t1 > 12 * 3600 || t1 < 5 * 3600;
        const partTime = rng.next() < 0.15;
        const hours = evening ? clamp(8.5 + rng.normal(), 6, 11) : partTime ? clamp(5 + 1.2 * rng.normal(), 3, 7) : clamp(8.9 + 0.8 * rng.normal(), 6.5, 11);
        let t2 = t1 + travel + hours * 3600;
        const type = rng.next() < 0.04 ? 'van' : null;
        add(t1, { purpose: 'work', type, from: homeB, to: workB, o, d });
        // Return home. Overnight shifts end tomorrow (dropped).
        if (t2 < 86400) {
          // Corridor homes go back out the way they came in.
          const back = h >= 0 ? o : this.corridorNode(-1 - h, false);
          const from2 = w >= 0 ? d : this.corridorNode(-1 - w, true);
          add(t2, { purpose: 'home', type, from: workB, to: homeB, o: from2, d: back });
        }
        commuters++;
      }
    }

    // --- School (only on school days) ---
    let schoolTrips = 0;
    const schoolOn = sc.school ?? clock.schoolDay;
    if (schoolOn) {
      const ms = (mult.school ?? 1) * demand * weather;
      for (const [si, flows] of this.schoolFlowsBySchool) {
        const s = this.schools[si];
        if (s.node == null) continue;
        const lo = s.lo ?? 0;
        const hi = s.hi ?? 12;
        const level = s.kind !== 'public' ? 'k12' : hi <= 5 ? 'elem' : lo >= 9 ? 'high' : lo >= 5 && hi <= 8 ? 'middle' : 'k12';
        const jit = ((si * 7919) % 21) - 10; // stagger bell times a little per school (minutes)
        const bell = { elem: 7.83, middle: 8.25, high: 8.0, k12: 8.0 }[level] * 3600 + jit * 60;
        const out = { elem: 14.75, middle: 15.33, high: 15.08, k12: 15.25 }[level] * 3600 + jit * 60;
        const share = s.kind === 'private' ? 0.82 : s.kind === 'charter' ? 0.72 : { elem: 0.42, middle: 0.36, high: 0.22, k12: 0.4 }[level];
        const teen = s.kind === 'public' && level === 'high' ? 0.13 : s.kind === 'private' && hi >= 12 ? 0.08 : 0;
        for (const k of flows) {
          const blk = dm.schBlock[k];
          const students = dm.schCount[k];
          const xDrive = students * share * 0.72 * ms;
          const xTeen = students * teen * ms;
          const nd = Math.floor(xDrive) + (rng.next() < xDrive % 1 ? 1 : 0);
          const nt = Math.floor(xTeen) + (rng.next() < xTeen % 1 ? 1 : 0);
          for (let q = 0; q < nd + nt; q++) {
            let home = this.byBlockKids.sample(blk, rng.next());
            if (home < 0 || this.weights.kids[home] <= 0) home = this.homeIn(blk);
            if (home < 0) continue;
            const o = b.node[home];
            if (o === s.node) continue;
            const travel = this.est(o, s.node);
            if (q < nd) {
              // Drop-off and back, pick-up and back.
              const t1 = bell - travel - (5 + 12 * rng.next()) * 60;
              add(t1, { purpose: 'school', from: home, to: -1, o, d: s.node, school: si,
                after: { dwell: 90 + 150 * rng.next(), next: { purpose: 'home', from: -1, to: home, o: s.node, d: o } } });
              const t3 = out - travel - (6 + 18 * rng.next()) * 60;
              add(t3, { purpose: 'school', from: home, to: -1, o, d: s.node, school: si,
                after: { atTime: out + (3 + 12 * rng.next()) * 60, next: { purpose: 'home', from: -1, to: home, o: s.node, d: o } } });
              schoolTrips += 4;
            } else {
              // Teen driver: to school, home after dismissal.
              add(bell - travel - (4 + 10 * rng.next()) * 60, { purpose: 'school', from: home, to: -1, o, d: s.node, school: si, type: rng.next() < 0.5 ? 'sedan' : 'hatch' });
              add(out + (2 + 25 * rng.next()) * 60, { purpose: 'home', from: -1, to: home, o: s.node, d: o });
              schoolTrips += 2;
            }
          }
        }
        // Yellow buses for public schools: one route in, one route out.
        if (s.kind === 'public' && s.enrollment > 0) {
          const buses = Math.round((s.enrollment * 0.32 * ms) / 48);
          const fl = flows.map((k) => dm.schCount[k]);
          const pick = new Sampler(fl);
          for (let q = 0; q < buses; q++) {
            const blk = dm.schBlock[flows[pick.sample(rng.next())]];
            const home = this.homeIn(blk);
            if (home < 0) continue;
            const o = b.node[home];
            if (o === s.node) continue;
            const travel = this.est(o, s.node) * 1.25;
            add(bell - travel - (10 + 10 * rng.next()) * 60, { purpose: 'school bus', type: 'schoolbus', from: home, to: -1, o, d: s.node, school: si });
            add(out + (4 + 6 * rng.next()) * 60, { purpose: 'school bus', type: 'schoolbus', from: -1, to: home, o: s.node, d: o, school: si });
            schoolTrips += 2;
          }
        }
      }
    }

    // --- Visitors: overnight guests' days and day-trippers ---
    const tour = (mult.tourist ?? 1) * demand * weather;
    const spots = { ...TOURIST_SPOTS, ...(sc.touristSpots || {}) };
    const spotIds = Object.keys(spots).filter((id) => this.venue[id]);
    const spotW = spotIds.map((id) => spots[id]);
    const pickSpot = () => {
      if (rng.next() < 0.07 && this.breweries.length) return this.breweries[Math.floor(rng.next() * this.breweries.length)];
      return this.venue[rng.weighted(spotIds, spotW)];
    };
    const occupancy = sc.hotelOccupancy ?? (dayType === 'saturday' || dayType === 'sunday' ? 0.86 : 0.72);
    const hotelParties = Math.round(9800 * occupancy * tour);
    const strParties = Math.round(8000 * 0.55 * occupancy / 0.75 * tour);
    let visitorTrips = 0;
    const visitorDay = (base, isHotel) => {
      // Morning outing, an afternoon stop, back to base; many head out again for dinner.
      const s1 = pickSpot();
      const s2 = rng.next() < 0.55 ? this.venue.downtown || pickSpot() : pickSpot();
      const t1 = (9 + 2.2 * rng.next()) * 3600;
      const dwell1 = (1.2 + 2 * rng.next()) * 3600;
      const dwell2 = (0.8 + 1.5 * rng.next()) * 3600;
      const n1 = this.spotNode(s1);
      const n2 = this.spotNode(s2);
      add(t1, { purpose: 'visit', from: isHotel ? -1 : base.building, to: -1, o: base.node, d: n1, spot: s1.name,
        after: { dwell: dwell1, next: { purpose: 'visit', o: this.spotNode(s1, true), d: n2, spot: s2.name,
          after: { dwell: dwell2, next: { purpose: 'lodging', o: this.spotNode(s2, true), d: base.node } } } } });
      visitorTrips += 3;
      if (rng.next() < 0.6) {
        const din = rng.next() < 0.6 ? this.venue.downtown : rng.next() < 0.5 && this.venue.rad ? this.venue.rad : pickSpot();
        if (din) {
          const dn = this.spotNode(din);
          add((17.8 + 1.6 * rng.next()) * 3600, { purpose: 'visit', o: base.node, d: dn, spot: din.name,
            after: { dwell: (1.3 + 1.2 * rng.next()) * 3600, next: { purpose: 'lodging', o: dn, d: base.node } } });
          visitorTrips += 2;
        }
      }
    };
    for (let q = 0; q < hotelParties; q++) {
      const h = this.hotels[this.hotelSampler.sample(rng.next())];
      if (h) visitorDay({ node: h.node }, true);
    }
    for (let q = 0; q < strParties; q++) {
      const i = this.strSampler.sample(rng.next());
      if (i >= 0) visitorDay({ node: b.node[i], building: i }, false);
    }
    const dayTrips = Math.round((sc.dayTrippers ?? (dayType === 'saturday' ? 7500 : dayType === 'sunday' ? 6000 : 3800)) * tour);
    for (let q = 0; q < dayTrips; q++) {
      const ci = this.pickCorridor(DAYTRIP_CORRIDORS);
      const s1 = pickSpot();
      const s2 = rng.next() < 0.5 ? this.venue.downtown || pickSpot() : pickSpot();
      const inNode = this.corridorNode(ci, true);
      const outNode = this.corridorNode(ci, false);
      const n1 = this.spotNode(s1);
      const n2 = this.spotNode(s2);
      add((8.5 + 3.5 * rng.next()) * 3600, { purpose: 'visit', o: inNode, d: n1, spot: s1.name,
        after: { dwell: (1.5 + 2.5 * rng.next()) * 3600, next: { purpose: 'visit', o: this.spotNode(s1, true), d: n2, spot: s2.name,
          after: { dwell: (0.8 + 1.6 * rng.next()) * 3600, next: { purpose: 'visit home', o: this.spotNode(s2, true), d: outNode } } } } });
      visitorTrips += 3;
    }

    // --- Events ---
    let eventTrips = 0;
    for (const ev of sc.events || []) {
      if (ev.active === false) continue;
      eventTrips += this.scheduleEvent(ev, add, demand);
    }

    sched.sort((a, b2) => a.tDep - b2.tDep);
    this.queue = sched;
    this.cursor = 0;

    // --- Streaming rates (per day) ---
    const tours = this.totalResidents * (TOURS_PP[dayType] ?? 0.66) * (mult.other ?? 1) * demand * weather;
    const freight = (dayType === 'weekday' ? 46000 : dayType === 'saturday' ? 17000 : 8000) * (mult.freight ?? 1) * demand * weather;
    const throughMult = (mult.through ?? 1) * demand;
    const regionalMult = (mult.regional ?? 1) * (dayType === 'weekday' ? 1 : dayType === 'saturday' ? 1.15 : 0.8) * demand * weather;
    const prof = PROFILE.other[dayType === 'holiday' ? 'sunday' : dayType] || PROFILE.other.weekday;
    this.streams = { tours, freight, throughMult, regionalMult, prof, profile: sc.otherProfile ? normalize(sc.otherProfile) : prof };
    for (let bin = 0; bin < 144; bin++) {
      const h = Math.floor(bin / 6);
      this.departuresByBin[bin] += (tours * 2 * prof[h] + freight * PROFILE.freight[h]) / 6
        + (THROUGH.reduce((a2, t) => a2 + t[2], 0) * throughMult * PROFILE.through[h]) / 6
        + (Object.values(REGIONAL).reduce((a2, v) => a2 + v, 0) * 2 * regionalMult * prof[h]) / 6;
    }
    this.summary = { commuters, schoolTrips, visitorTrips, eventTrips, toursPerDay: Math.round(tours), freightPerDay: Math.round(freight),
      scheduled: sched.length, dayType };
    return this.summary;
  }

  scheduleEvent(ev, add, demand) {
    const rng = this.rng;
    const b = this.data.buildings;
    const venue = this.venue[ev.venue];
    if (!venue) return 0;
    const occupancy = ev.occupancy ?? 2.5;
    const cars = Math.round(((ev.attendance ?? 1000) / occupancy) * (ev.driveShare ?? 0.9) * demand);
    // Where people park: decks and lots near the venue, else the venue itself.
    const near = this.parking.filter((p) => Math.hypot(p.x - venue.x, p.z - venue.z) < (ev.parkRadius ?? 900));
    const parkNodes = near.length ? near.map((p) => p.node) : [venue.node];
    const parkW = near.length ? near.map((p) => Math.max(60, p.capacity || 150)) : [1];
    const parkSampler = new Sampler(parkW, parkNodes);
    // Local fans: residents, weighted toward the venue.
    const local = new Float32Array(this.weights.res.length);
    for (let i = 0; i < local.length; i++) {
      if (this.weights.res[i] <= 0) continue;
      const km = Math.hypot(b.x[i] - venue.x, b.z[i] - venue.z) / 1000;
      local[i] = this.weights.res[i] * Math.exp(-km / (ev.localKm ?? 9));
    }
    const localSampler = new Sampler(local);
    const regionalShare = ev.regional ?? 0.22;
    const visitorShare = ev.visitors ?? 0.15;
    let n = 0;
    for (let q = 0; q < cars; q++) {
      const r = rng.next();
      let o;
      let back;
      let from = -1;
      if (r < regionalShare) {
        const ci = this.pickCorridor(EVENT_CORRIDORS);
        o = this.corridorNode(ci, true);
        back = this.corridorNode(ci, false);
      } else if (r < regionalShare + visitorShare && this.hotels.length) {
        o = this.hotels[this.hotelSampler.sample(rng.next())].node;
        back = o;
      } else {
        from = localSampler.sample(rng.next());
        if (from < 0) continue;
        o = b.node[from];
        back = o;
      }
      const park = parkSampler.sample(rng.next());
      const travel = this.est(o, park);
      let tArrive;
      let leave;
      if (ev.window) {
        // Timed entry (holiday lights, Candlelight evenings): arrivals spread over the window.
        tArrive = (ev.window[0] + (ev.window[1] - ev.window[0]) * rng.next()) * 3600;
        leave = { dwell: (ev.stayHours ?? 2.5) * 3600 * (0.8 + 0.4 * rng.next()) };
      } else {
        // Arrive over the two hours before start, most 30-60 minutes early.
        const u = rng.next() + rng.next();
        tArrive = (ev.start - 2.0 + u * 1.15) * 3600;
        const after = Math.abs(rng.normal()) * 14 + (rng.next() < 0.15 ? -15 * rng.next() : 2);
        leave = { atTime: ev.end * 3600 + after * 60 };
      }
      add(tArrive - travel, { purpose: 'event', o, d: park, from, to: -1, event: ev.id, after: { ...leave, next: { purpose: 'event home', o: park, d: back, to: from } } });
      n += 2;
    }
    return n;
  }

  /**
   * Emit trips departing in [t0, t1) into `push(trip)`: scheduled trips plus streaming errands,
   * freight, through and regional traffic.
   */
  emit(t0, t1, push) {
    const q = this.queue;
    while (this.cursor < q.length && q[this.cursor].tDep < t1) {
      const trip = q[this.cursor++];
      if (trip.tDep >= t0 - 3600) push(trip);
    }
    const st = this.streams;
    if (!st) return;
    const rng = this.rng;
    const b = this.data.buildings;
    const hour = Math.floor(((t0 % 86400) + 86400) % 86400 / 3600);
    const frac = (t1 - t0) / 3600;
    const prof = st.profile;
    // Errands and leisure tours from home.
    const nTours = poisson(st.tours * prof[hour] * frac, rng);
    for (let k = 0; k < nTours; k++) {
      const home = this.allRes.sample(rng.next());
      if (home < 0) continue;
      const dest = this.errandDestination(b.bg[home]);
      if (dest < 0) continue;
      const o = b.node[home];
      const d = b.node[dest];
      if (o === d) continue;
      const r = rng.next();
      const dwell = r < 0.4 ? 25 + 50 * rng.next() : r < 0.65 ? 10 + 20 * rng.next() : r < 0.9 ? 60 + 120 * rng.next() : 45 + 75 * rng.next();
      const purpose = r < 0.4 ? 'shopping' : r < 0.65 ? 'errand' : r < 0.9 ? 'social' : 'medical';
      push({ purpose, from: home, to: dest, o, d, tDep: t0 + rng.next() * (t1 - t0),
        after: { dwell: dwell * 60, next: { purpose: 'home', from: dest, to: home, o: d, d: o } } });
    }
    // Freight.
    const nF = poisson(st.freight * PROFILE.freight[hour] * frac, rng);
    for (let k = 0; k < nF; k++) {
      const r = rng.next();
      const type = r < 0.5 ? 'van' : r < 0.88 ? 'truck' : 'semi';
      let o;
      let d;
      let from = -1;
      let to = -1;
      if (rng.next() < (type === 'semi' ? 0.55 : 0.12)) {
        // Freight to or from outside the county comes and goes on the interstates.
        const ci = this.pickCorridor({ i26e: 0.4, i40e: 0.3, i40w: 0.2, i26n: 0.1 });
        const local = this.allFreight.sample(rng.next());
        if (local < 0) continue;
        if (rng.next() < 0.5) {
          o = this.corridorNode(ci, true);
          d = b.node[local];
          to = local;
        } else {
          o = b.node[local];
          d = this.corridorNode(ci, false);
          from = local;
        }
      } else {
        from = this.allFreight.sample(rng.next());
        to = this.allFreight.sample(rng.next());
        if (from < 0 || to < 0) continue;
        o = b.node[from];
        d = b.node[to];
      }
      if (o === d) continue;
      push({ purpose: 'delivery', type, from, to, o, d, tDep: t0 + rng.next() * (t1 - t0) });
    }
    // Through traffic on the interstates.
    for (const [a, c, perDay] of THROUGH) {
      const n = poisson(perDay * st.throughMult * PROFILE.through[hour] * frac, rng);
      for (let k = 0; k < n; k++) {
        const fwd = rng.next() < 0.5;
        const ci = this.corridorIndex[fwd ? a : c];
        const cj = this.corridorIndex[fwd ? c : a];
        if (ci == null || cj == null) continue;
        const o = this.corridorNode(ci, true);
        const d = this.corridorNode(cj, false);
        const type = rng.next() < 0.3 ? 'semi' : null;
        push({ purpose: 'through', type, o, d, tDep: t0 + rng.next() * (t1 - t0) });
      }
    }
    // Airport runs: residents and hotel guests to and from Asheville Regional Airport.
    const avl = this.venue.avl;
    if (avl) {
      const n = poisson(AIRPORT_TRIPS * st.regionalMult * PROFILE.through[hour] * frac, rng);
      for (let k = 0; k < n; k++) {
        let o;
        let from = -1;
        if (rng.next() < 0.35 && this.hotels.length) o = this.hotels[this.hotelSampler.sample(rng.next())].node;
        else {
          from = this.allRes.sample(rng.next());
          if (from < 0) continue;
          o = b.node[from];
        }
        const toAirport = rng.next() < 0.5;
        push({ purpose: 'airport', o: toAirport ? o : avl.node, d: toAirport ? avl.node : o, from: toAirport ? from : -1, to: toAirport ? -1 : from,
          tDep: t0 + rng.next() * (t1 - t0) });
      }
    }
    // Regional drivers from neighboring counties: shopping, doctors, visits.
    for (const [cid, perDay] of Object.entries(REGIONAL)) {
      const ci = this.corridorIndex[cid];
      if (ci == null) continue;
      const n = poisson(perDay * st.regionalMult * prof[hour] * frac, rng);
      if (!n) continue;
      const c = this.corridors[ci];
      const gbg = this.bgNear(c.x, c.z);
      for (let k = 0; k < n; k++) {
        // Half stop near where they come in; half head for the county's big draws (Mission
        // Hospital, Asheville Mall, downtown, Biltmore Park...) wherever they are.
        const dest = rng.next() < 0.25 ? this.errandDestination(gbg) : this.byBgAttract.sample(this.bgAnyAttract.sample(rng.next()), rng.next());
        if (dest < 0) continue;
        const o = this.corridorNode(ci, true);
        const d = b.node[dest];
        push({ purpose: 'regional', o, d, from: -1, to: dest, tDep: t0 + rng.next() * (t1 - t0),
          after: { dwell: (50 + 130 * rng.next()) * 60, next: { purpose: 'regional home', from: dest, to: -1, o: d, d: this.corridorNode(ci, false) } } });
      }
    }
  }

  /** Expected vehicles on the road at an hour (for the HUD's demand curve). */
  expectedActive(hour) {
    const bin = Math.floor(((hour % 24) + 24) % 24 * 6);
    // About 15 minutes per trip: departures in the last ~1.5 bins are on the road.
    const a = this.departuresByBin[bin] || 0;
    const p = this.departuresByBin[(bin + 143) % 144] || 0;
    return (a + p * 0.5) * this.world.sample;
  }
}

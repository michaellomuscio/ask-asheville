// Loads everything the simulation knows about Buncombe County from data/ and exposes it as
// typed arrays with a few lookup helpers. Works in the browser and under Node (no rendering).

import { loadBundle, loadJSON, isNode } from './bundle.js';
import { RoadNetwork } from '../sim/graph.js';

export const KIND = {
  HOUSE: 0, TOWNHOME: 1, CONDO: 2, APARTMENT: 3, MOBILE_HOME: 4, GROUP_QUARTERS: 5, HOTEL: 6, RETAIL: 7, OFFICE: 8,
  COMMERCIAL: 9, INDUSTRIAL: 10, WAREHOUSE: 11, SCHOOL: 12, UNIVERSITY: 13, CHURCH: 14, HOSPITAL: 15, MEDICAL: 16,
  GOVERNMENT: 17, CIVIC: 18, RECREATION: 19, PARKING: 20, FARM: 21, ACCESSORY: 22, UTILITY: 23, MIXED_USE: 24, OTHER: 25,
};
export const KIND_LABEL = [
  'Single-family home', 'Townhomes', 'Condominiums', 'Apartment building', 'Manufactured home', 'Group quarters', 'Hotel or inn',
  'Retail', 'Office', 'Commercial', 'Industrial', 'Warehouse', 'School', 'College or university', 'Place of worship', 'Hospital',
  'Medical office', 'Government', 'Civic or cultural', 'Recreation', 'Parking structure', 'Farm building', 'Garage, shed or outbuilding',
  'Utility', 'Mixed use', 'Other building',
];
export const RESIDENTIAL_KINDS = new Set([0, 1, 2, 3, 4, 24]);

export class Buildings {
  constructor(bundle) {
    const a = bundle.arrays;
    this.meta = bundle.meta;
    this.count = a.x.length;
    Object.assign(this, {
      x: a.x, z: a.z, area: a.area, heightDm: a.height_dm, floors: a.floors, kind: a.kind, roof: a.roof, gable: a.gable,
      units: a.units, households: a.households, residents: a.residents, gq: a.gq, kids10: a.kids10, seniors10: a.seniors10,
      jobs: a.jobs, block: a.block, parcelClass: a.parcel_class, addrCount: a.addr_count, node: a.node, snapDm: a.snap_dm,
      ringOff: a.r_off, ringX: a.r_x, ringZ: a.r_z,
    });
    this.names = bundle.meta.names || {};
    this.base = new Float32Array(this.count); // ground height under the footprint, set by the renderer
    this.buildIndex();
  }

  height(i) {
    return this.heightDm[i] / 10;
  }

  name(i) {
    return this.names[i] || '';
  }

  buildIndex() {
    const G = 200;
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (let i = 0; i < this.count; i++) {
      if (this.x[i] < x0) x0 = this.x[i];
      if (this.x[i] > x1) x1 = this.x[i];
      if (this.z[i] < z0) z0 = this.z[i];
      if (this.z[i] > z1) z1 = this.z[i];
    }
    this.grid = { G, x0: x0 - G, z0: z0 - G, w: Math.ceil((x1 - x0) / G) + 3, h: Math.ceil((z1 - z0) / G) + 3 };
    const cells = this.grid.w * this.grid.h;
    const start = new Int32Array(cells + 1);
    const cellOf = new Int32Array(this.count);
    for (let i = 0; i < this.count; i++) {
      const c = this.cell(this.x[i], this.z[i]);
      cellOf[i] = c;
      start[c + 1]++;
    }
    for (let c = 0; c < cells; c++) start[c + 1] += start[c];
    const items = new Int32Array(this.count);
    const fill = start.slice(0, cells);
    for (let i = 0; i < this.count; i++) items[fill[cellOf[i]]++] = i;
    this.cellStart = start;
    this.cellItems = items;
  }

  cell(x, z) {
    const g = this.grid;
    const cx = Math.min(g.w - 1, Math.max(0, Math.floor((x - g.x0) / g.G)));
    const cz = Math.min(g.h - 1, Math.max(0, Math.floor((z - g.z0) / g.G)));
    return cz * g.w + cx;
  }

  /** Calls fn(i) for buildings whose centers lie within `r` meters of (x, z). */
  forEachNear(x, z, r, fn) {
    const g = this.grid;
    const c0x = Math.max(0, Math.floor((x - r - g.x0) / g.G));
    const c1x = Math.min(g.w - 1, Math.floor((x + r - g.x0) / g.G));
    const c0z = Math.max(0, Math.floor((z - r - g.z0) / g.G));
    const c1z = Math.min(g.h - 1, Math.floor((z + r - g.z0) / g.G));
    const r2 = r * r;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const c = cz * g.w + cx;
        for (let k = this.cellStart[c]; k < this.cellStart[c + 1]; k++) {
          const i = this.cellItems[k];
          if ((this.x[i] - x) ** 2 + (this.z[i] - z) ** 2 <= r2) fn(i);
        }
      }
    }
  }

  /** Point-in-footprint test (footprint vertices are decimeter offsets from the center). */
  contains(i, x, z) {
    const o0 = this.ringOff[i];
    const o1 = this.ringOff[i + 1];
    const px = (x - this.x[i]) * 10;
    const pz = (z - this.z[i]) * 10;
    let inside = false;
    for (let a = o0, b = o1 - 1; a < o1; b = a++) {
      const ax = this.ringX[a]; const az = this.ringZ[a];
      const bx = this.ringX[b]; const bz = this.ringZ[b];
      if ((az > pz) !== (bz > pz) && px < ((bx - ax) * (pz - az)) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  }

  /** Building whose footprint contains (x, z), else the nearest center within `r`. */
  pick(x, z, r = 25) {
    let best = -1;
    let bestD = r * r;
    let hit = -1;
    this.forEachNear(x, z, 120, (i) => {
      if (hit < 0 && this.contains(i, x, z)) hit = i;
      const d = (this.x[i] - x) ** 2 + (this.z[i] - z) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return hit >= 0 ? hit : best;
  }
}

export class Terrain {
  constructor(bundle) {
    const m = bundle.meta;
    this.meta = m;
    this.nx = m.nx;
    this.nz = m.nz;
    this.x0 = m.x0;
    this.z0 = m.z0;
    this.cell = m.cell;
    const p = bundle.arrays.height;
    const q = new Int32Array(this.nx * this.nz);
    const nx = this.nx;
    for (let r = 0; r < this.nz; r++) {
      const o = r * nx;
      for (let c = 0; c < nx; c++) {
        let v = p[o + c];
        if (r === 0 && c === 0) q[0] = v;
        else if (r === 0) q[c] = v + q[c - 1];
        else if (c === 0) q[o] = v + q[o - nx];
        else q[o + c] = v + q[o + c - 1] + q[o - nx + c] - q[o - nx + c - 1];
      }
    }
    const scale = m.scale || 0.1;
    this.height = new Float32Array(this.nx * this.nz);
    for (let i = 0; i < q.length; i++) this.height[i] = m.hmin + q[i] * scale;
    this.landcover = bundle.arrays.landcover;
    this.x1 = this.x0 + (this.nx - 1) * this.cell;
    this.z1 = this.z0 + (this.nz - 1) * this.cell;
  }

  /** Bilinear height (m) of the 30 m grid. */
  sample(x, z) {
    const fx = (x - this.x0) / this.cell;
    const fz = (z - this.z0) / this.cell;
    let ix = Math.floor(fx);
    let iz = Math.floor(fz);
    if (ix < 0) ix = 0; else if (ix > this.nx - 2) ix = this.nx - 2;
    if (iz < 0) iz = 0; else if (iz > this.nz - 2) iz = this.nz - 2;
    let tx = fx - ix; let tz = fz - iz;
    tx = tx < 0 ? 0 : tx > 1 ? 1 : tx;
    tz = tz < 0 ? 0 : tz > 1 ? 1 : tz;
    const h = this.height;
    const o = iz * this.nx + ix;
    return h[o] * (1 - tx) * (1 - tz) + h[o + 1] * tx * (1 - tz) + h[o + this.nx] * (1 - tx) * tz + h[o + this.nx + 1] * tx * tz;
  }

  landcoverAt(x, z) {
    const ix = Math.round((x - this.x0) / this.cell);
    const iz = Math.round((z - this.z0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return 0;
    return this.landcover[iz * this.nx + ix];
  }
}

export class Demand {
  constructor(bundle) {
    const a = bundle.arrays;
    this.meta = bundle.meta;
    this.corridors = bundle.meta.corridors;
    this.schools = bundle.meta.schools;
    this.odHome = a.od_home;
    this.odWork = a.od_work;
    this.odCount = a.od_count;
    this.schSchool = a.sch_school;
    this.schBlock = a.sch_block;
    this.schCount = a.sch_count;
  }
}

/**
 * Load the whole dataset.
 * @param {string} base folder URL (browser) or path (Node), ending in '/'
 * @param {{onProgress?: (label: string, fraction: number) => void, terrain?: boolean, addresses?: boolean}} [o]
 */
export async function loadWorldData(base = './data/', o = {}) {
  const progress = o.onProgress || (() => {});
  const want = (k) => o[k] !== false;
  const jobs = {
    manifest: loadJSON(base + 'manifest.json'),
    roads: loadBundle(base + 'roads.bin.gz', (f) => progress('Paving the roads', f)),
    buildings: loadBundle(base + 'buildings.bin.gz', (f) => progress('Raising 185,000 buildings', f)),
    areas: loadJSON(base + 'areas.json'),
    pois: loadJSON(base + 'pois.json'),
    demand: loadBundle(base + 'demand.bin.gz'),
    county: loadJSON(base + 'county.json'),
    ors: loadJSON(base + 'ors_reference.json'),
  };
  if (want('terrain')) jobs.terrain = loadBundle(base + 'terrain.bin.gz', (f) => progress('Shaping the mountains', f));
  if (want('water')) jobs.water = loadBundle(base + 'water.bin.gz');
  const keys = Object.keys(jobs);
  const vals = await Promise.all(keys.map((k) => jobs[k]));
  const raw = Object.fromEntries(keys.map((k, i) => [k, vals[i]]));
  const data = {
    base,
    manifest: raw.manifest,
    roads: new RoadNetwork(raw.roads),
    buildings: new Buildings(raw.buildings),
    areas: raw.areas,
    pois: raw.pois,
    demand: new Demand(raw.demand),
    county: raw.county,
    ors: raw.ors,
    terrain: raw.terrain ? new Terrain(raw.terrain) : null,
    water: raw.water || null,
  };
  // Buildings and places snapped onto a one-way stub at the county edge could never reach the
  // rest of the county; move them to the nearest node in the strongly connected core.
  const net = data.roads;
  const core = net.strongCore();
  const usable = (nd) => {
    if (!core[nd]) return false;
    for (let k = net.outStart[nd]; k < net.outStart[nd + 1]; k++) if (net.cls[net.outEdges[k]] > 3) return true;
    return false;
  };
  const bs = data.buildings;
  let moved = 0;
  for (let i = 0; i < bs.count; i++) {
    if (!core[bs.node[i]]) {
      const nn = net.nearestNode(bs.x[i], bs.z[i], usable);
      if (nn >= 0) {
        bs.node[i] = nn;
        moved++;
      }
    }
  }
  for (const p of data.pois) {
    if (p.node != null && !core[p.node]) {
      const nn = net.nearestNode(p.x, p.z, usable);
      if (nn >= 0) p.node = nn;
    }
  }
  data.resnapped = moved;
  // Block group of each building (blocks nest in block groups).
  const blockBg = data.areas.block.bg;
  const b = data.buildings;
  b.bg = new Uint16Array(b.count);
  for (let i = 0; i < b.count; i++) b.bg[i] = blockBg[b.block[i]];
  // Default destination for drive times: downtown Asheville (Pack Square, the map origin).
  data.focus = data.pois.find((p) => p.id === 'downtown')
    || { kind: 'place', sub: 'destination', name: 'Downtown Asheville (Pack Square)', x: 0, z: 0, node: net.nearestNode(0, 0, usable) };
  return data;
}

/** Address search index (lazy; ~2 MB). */
export async function loadAddresses(base = './data/') {
  const bundle = await loadBundle(base + 'addresses.bin.gz');
  const labels = bundle.meta.labels.split('\n');
  return { labels, x: bundle.arrays.x, z: bundle.arrays.z, building: bundle.arrays.building };
}

export { isNode };

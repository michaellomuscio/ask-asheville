// The road network as typed arrays: nodes, directed edges, and the polylines they share.
// Used by routing, the traffic simulation and the renderer. Rendering-free.

export const LANE_W = 3.4;
export const CLASS = {
  MOTORWAY: 0, MOTORWAY_LINK: 1, TRUNK: 2, TRUNK_LINK: 3, PRIMARY: 4, PRIMARY_LINK: 5, SECONDARY: 6, SECONDARY_LINK: 7,
  TERTIARY: 8, TERTIARY_LINK: 9, UNCLASSIFIED: 10, RESIDENTIAL: 11, LIVING_STREET: 12, SERVICE: 13, ROAD: 14, BUSWAY: 15,
};
export const FLAG = { BRIDGE: 1, TUNNEL: 2, ROUNDABOUT: 4, ONEWAY: 8, DEFAULT_SPEED: 16 };
export const CTRL = { NONE: 0, YIELD: 1, STOP: 2, SIGNAL: 3 };

const GRID = 250; // spatial index cell (m)

export class RoadNetwork {
  /** @param {{meta: object, arrays: object}} bundle roads.bin.gz */
  constructor(bundle) {
    const a = bundle.arrays;
    const m = bundle.meta;
    this.names = m.names;
    this.classes = m.classes;
    this.gateways = m.gateways;
    this.nodeX = a.node_x;
    this.nodeZ = a.node_z;
    this.nodeSignal = a.node_signal;
    this.nodeInCounty = a.node_in_county;
    this.nodeGateway = a.node_gateway;
    this.nodeCount = a.node_x.length;
    this.nodeY = new Float32Array(this.nodeCount);

    this.from = a.e_from;
    this.to = a.e_to;
    this.len = a.e_len;
    this.speed = a.e_speed; // ORS-calibrated free-flow, m/s
    this.vsim = a.e_vsim; // what simulated drivers aim for, m/s
    this.posted = a.e_posted; // km/h (default where untagged)
    this.lanes = a.e_lanes;
    this.cls = a.e_cls;
    this.rank = a.e_rank;
    this.flags = a.e_flags;
    this.ctrl = a.e_ctrl;
    this.nameId = a.e_name;
    this.geom = a.e_geom;
    this.dir = a.e_dir;
    this.edgeCount = a.e_from.length;

    this.geomOff = a.g_off;
    this.gx = a.g_x;
    this.gz = a.g_z;
    this.geomCount = a.g_off.length - 1;
    this.gy = new Float32Array(this.gx.length);

    // Free-flow travel time per edge (s) and the polyline length per geometry.
    const E = this.edgeCount;
    this.ffTime = new Float32Array(E);
    for (let e = 0; e < E; e++) this.ffTime[e] = this.len[e] / Math.max(0.5, this.speed[e]);
    this.geomCum = new Float32Array(this.gx.length);
    this.geomLen = new Float32Array(this.geomCount);
    for (let g = 0; g < this.geomCount; g++) {
      const o0 = this.geomOff[g];
      const o1 = this.geomOff[g + 1];
      let acc = 0;
      this.geomCum[o0] = 0;
      for (let i = o0 + 1; i < o1; i++) {
        acc += Math.hypot(this.gx[i] - this.gx[i - 1], this.gz[i] - this.gz[i - 1]);
        this.geomCum[i] = acc;
      }
      this.geomLen[g] = acc;
    }

    this.buildAdjacency();
    this.buildTwins();
    this.buildIndex();
  }

  buildAdjacency() {
    const n = this.nodeCount;
    const E = this.edgeCount;
    const outStart = new Int32Array(n + 1);
    const inStart = new Int32Array(n + 1);
    for (let e = 0; e < E; e++) {
      outStart[this.from[e] + 1]++;
      inStart[this.to[e] + 1]++;
    }
    for (let i = 0; i < n; i++) {
      outStart[i + 1] += outStart[i];
      inStart[i + 1] += inStart[i];
    }
    const outEdges = new Int32Array(E);
    const inEdges = new Int32Array(E);
    const oc = outStart.slice(0, n);
    const ic = inStart.slice(0, n);
    for (let e = 0; e < E; e++) {
      outEdges[oc[this.from[e]]++] = e;
      inEdges[ic[this.to[e]]++] = e;
    }
    this.outStart = outStart;
    this.outEdges = outEdges;
    this.inStart = inStart;
    this.inEdges = inEdges;
    // Node "importance": highest class rank touching it (for priority and labels).
    this.nodeRank = new Uint8Array(n);
    for (let e = 0; e < E; e++) {
      const r = this.rank[e];
      if (r > this.nodeRank[this.from[e]]) this.nodeRank[this.from[e]] = r;
      if (r > this.nodeRank[this.to[e]]) this.nodeRank[this.to[e]] = r;
    }
    let vmax = 0;
    for (let e = 0; e < E; e++) if (this.speed[e] > vmax) vmax = this.speed[e];
    this.maxSpeed = vmax;
  }

  buildTwins() {
    const E = this.edgeCount;
    this.twin = new Int32Array(E).fill(-1);
    const byGeom = new Int32Array(this.geomCount).fill(-1);
    for (let e = 0; e < E; e++) {
      const g = this.geom[e];
      if (byGeom[g] < 0) byGeom[g] = e;
      else {
        const o = byGeom[g];
        if (this.dir[o] !== this.dir[e]) {
          this.twin[e] = o;
          this.twin[o] = e;
        }
      }
    }
    // Lanes per geometry in each direction (for road widths).
    this.geomLanesFwd = new Uint8Array(this.geomCount);
    this.geomLanesBwd = new Uint8Array(this.geomCount);
    this.geomEdge = new Int32Array(this.geomCount).fill(-1); // a representative edge
    for (let e = 0; e < E; e++) {
      const g = this.geom[e];
      if (this.dir[e] > 0) this.geomLanesFwd[g] = this.lanes[e];
      else this.geomLanesBwd[g] = this.lanes[e];
      if (this.geomEdge[g] < 0 || this.dir[e] > 0) this.geomEdge[g] = e;
    }
  }

  buildIndex() {
    let x0 = Infinity; let z0 = Infinity; let x1 = -Infinity; let z1 = -Infinity;
    for (let i = 0; i < this.nodeCount; i++) {
      const x = this.nodeX[i];
      const z = this.nodeZ[i];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    this.bounds = { x0, z0, x1, z1 };
    this.gridX0 = x0 - GRID;
    this.gridZ0 = z0 - GRID;
    this.gridW = Math.ceil((x1 - x0) / GRID) + 3;
    this.gridH = Math.ceil((z1 - z0) / GRID) + 3;
    const cells = this.gridW * this.gridH;
    // Nodes per cell (CSR).
    const cnt = new Int32Array(cells + 1);
    const cellOf = new Int32Array(this.nodeCount);
    for (let i = 0; i < this.nodeCount; i++) {
      const c = this.cellIndex(this.nodeX[i], this.nodeZ[i]);
      cellOf[i] = c;
      cnt[c + 1]++;
    }
    for (let c = 0; c < cells; c++) cnt[c + 1] += cnt[c];
    const items = new Int32Array(this.nodeCount);
    const fill = cnt.slice(0, cells);
    for (let i = 0; i < this.nodeCount; i++) items[fill[cellOf[i]]++] = i;
    this.nodeCellStart = cnt;
    this.nodeCellItems = items;
    // Polyline segments per cell, for nearest-road queries. Segment id = point index of its start.
    const segCount = [];
    const segCells = [];
    for (let g = 0; g < this.geomCount; g++) {
      for (let i = this.geomOff[g]; i < this.geomOff[g + 1] - 1; i++) {
        const mx = (this.gx[i] + this.gx[i + 1]) / 2;
        const mz = (this.gz[i] + this.gz[i + 1]) / 2;
        segCells.push(this.cellIndex(mx, mz), i);
      }
    }
    const sc = new Int32Array(cells + 1);
    for (let k = 0; k < segCells.length; k += 2) sc[segCells[k] + 1]++;
    for (let c = 0; c < cells; c++) sc[c + 1] += sc[c];
    const sitems = new Int32Array(segCells.length / 2);
    const sfill = sc.slice(0, cells);
    for (let k = 0; k < segCells.length; k += 2) sitems[sfill[segCells[k]]++] = segCells[k + 1];
    this.segCellStart = sc;
    this.segCellItems = sitems;
    // Point index -> geometry, for segment lookups.
    this.pointGeom = new Int32Array(this.gx.length);
    for (let g = 0; g < this.geomCount; g++) this.pointGeom.fill(g, this.geomOff[g], this.geomOff[g + 1]);
    void segCount;
  }

  cellIndex(x, z) {
    const cx = Math.min(this.gridW - 1, Math.max(0, Math.floor((x - this.gridX0) / GRID)));
    const cz = Math.min(this.gridH - 1, Math.max(0, Math.floor((z - this.gridZ0) / GRID)));
    return cz * this.gridW + cx;
  }

  /** Nearest node to (x, z), optionally accepted by `filter(node)`. Searches outward ring by ring. */
  nearestNode(x, z, filter = null, maxDist = 20000) {
    const cx = Math.floor((x - this.gridX0) / GRID);
    const cz = Math.floor((z - this.gridZ0) / GRID);
    let best = -1;
    let bestD = maxDist * maxDist;
    const maxR = Math.ceil(maxDist / GRID) + 1;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= this.gridW || gz >= this.gridH) continue;
          const c = gz * this.gridW + gx;
          for (let k = this.nodeCellStart[c]; k < this.nodeCellStart[c + 1]; k++) {
            const i = this.nodeCellItems[k];
            const d = (this.nodeX[i] - x) ** 2 + (this.nodeZ[i] - z) ** 2;
            if (d < bestD && (!filter || filter(i))) {
              bestD = d;
              best = i;
            }
          }
        }
      }
      // Anything in ring r+1 is at least r*GRID away.
      if (best >= 0 && bestD < (r * GRID) ** 2) break;
    }
    return best;
  }

  /** Nearest polyline segment: {geom, point, t, dist, x, z}. */
  nearestSegment(x, z, maxDist = 2000) {
    const cx = Math.floor((x - this.gridX0) / GRID);
    const cz = Math.floor((z - this.gridZ0) / GRID);
    let best = null;
    let bestD = maxDist * maxDist;
    const maxR = Math.ceil(maxDist / GRID) + 1;
    for (let r = 0; r <= maxR; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const gx = cx + dx;
          const gz = cz + dz;
          if (gx < 0 || gz < 0 || gx >= this.gridW || gz >= this.gridH) continue;
          const c = gz * this.gridW + gx;
          for (let k = this.segCellStart[c]; k < this.segCellStart[c + 1]; k++) {
            const i = this.segCellItems[k];
            const ax = this.gx[i];
            const az = this.gz[i];
            const bx = this.gx[i + 1];
            const bz = this.gz[i + 1];
            const vx = bx - ax;
            const vz = bz - az;
            const L = vx * vx + vz * vz || 1e-9;
            let t = ((x - ax) * vx + (z - az) * vz) / L;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const px = ax + vx * t;
            const pz = az + vz * t;
            const d = (px - x) ** 2 + (pz - z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = { geom: this.pointGeom[i], point: i, t, dist: Math.sqrt(d), x: px, z: pz };
            }
          }
        }
      }
      if (best && bestD < ((r) * GRID) ** 2) break;
    }
    return best;
  }

  /**
   * Nodes you can both reach from and return to the heart of the network (1 = in the core).
   * One-way stubs at the county edge (only entering or only leaving) are outside it; the
   * pipeline keeps them so traffic can come and go through the gateways.
   */
  strongCore() {
    if (this._core) return this._core;
    const n = this.nodeCount;
    const start = this.nearestNode((this.bounds.x0 + this.bounds.x1) / 2, (this.bounds.z0 + this.bounds.z1) / 2);
    const reach = (fwd) => {
      const seen = new Uint8Array(n);
      const stack = [start];
      seen[start] = 1;
      const st = fwd ? this.outStart : this.inStart;
      const adj = fwd ? this.outEdges : this.inEdges;
      const other = fwd ? this.to : this.from;
      while (stack.length) {
        const u = stack.pop();
        for (let k = st[u]; k < st[u + 1]; k++) {
          const v = other[adj[k]];
          if (!seen[v]) {
            seen[v] = 1;
            stack.push(v);
          }
        }
      }
      return seen;
    };
    const a = reach(true);
    const b = reach(false);
    const core = new Uint8Array(n);
    for (let i = 0; i < n; i++) core[i] = a[i] & b[i];
    this._core = core;
    return core;
  }

  /** Edges (one per direction) running along a geometry. */
  edgesOfGeom(g) {
    const e = this.geomEdge[g];
    if (e < 0) return [];
    return this.twin[e] >= 0 ? [e, this.twin[e]] : [e];
  }

  /**
   * Position along edge `e` at distance `s` (meters of the edge's length) into `out`:
   * x, y, z of the centerline and the unit travel direction dx, dy, dz.
   */
  pointAt(e, s, out) {
    const g = this.geom[e];
    const o0 = this.geomOff[g];
    const o1 = this.geomOff[g + 1] - 1;
    const total = this.geomLen[g];
    let u = (s / (this.len[e] || 1)) * total;
    if (u < 0) u = 0;
    else if (u > total) u = total;
    const fwd = this.dir[e] > 0;
    const t = fwd ? u : total - u;
    // Binary search the segment containing t.
    let lo = o0;
    let hi = o1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.geomCum[mid] <= t) lo = mid;
      else hi = mid;
    }
    const segLen = this.geomCum[hi] - this.geomCum[lo] || 1e-6;
    const f = (t - this.geomCum[lo]) / segLen;
    const ax = this.gx[lo]; const az = this.gz[lo]; const ay = this.gy[lo];
    const bx = this.gx[hi]; const bz = this.gz[hi]; const by = this.gy[hi];
    out.x = ax + (bx - ax) * f;
    out.z = az + (bz - az) * f;
    out.y = ay + (by - ay) * f;
    let dx = bx - ax;
    let dy = by - ay;
    let dz = bz - az;
    if (!fwd) {
      dx = -dx;
      dy = -dy;
      dz = -dz;
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    out.dx = dx / l;
    out.dy = dy / l;
    out.dz = dz / l;
    return out;
  }

  /** Lateral offset (m, positive = right of travel) for lane `lane` (0 = rightmost... see below) of edge e. */
  laneOffset(e, lane) {
    const n = this.lanes[e] || 1;
    // Lane 0 is the outer (curb-side) lane. Two-way roads put all lanes right of the centerline.
    if (this.twin[e] >= 0) return (n - lane - 0.5) * LANE_W;
    return (n / 2 - lane - 0.5) * LANE_W;
  }

  edgeLabel(e) {
    const n = this.names[this.nameId[e]];
    if (n) return n;
    const c = this.classes[this.cls[e]];
    return c === 'service' ? 'Service road' : c === 'residential' ? 'Residential street' : c.replace('_link', ' ramp').replace(/^\w/, (ch) => ch.toUpperCase());
  }

  /** Compass heading (degrees, 0 = north) of edge e near its start. */
  heading(e) {
    const p = this.pointAt(e, Math.min(10, this.len[e] / 2), { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 });
    return (Math.atan2(p.dx, -p.dz) * 180 / Math.PI + 360) % 360;
  }

  /**
   * Fill polyline and node heights from a terrain sampler `h(x, z)`. Bridges and tunnels run
   * straight between their ends so decks span valleys and bores pass under ridges.
   */
  setHeights(h, lift = 0.0) {
    for (let g = 0; g < this.geomCount; g++) {
      const o0 = this.geomOff[g];
      const o1 = this.geomOff[g + 1];
      const e = this.geomEdge[g];
      const span = e >= 0 && (this.flags[e] & (FLAG.BRIDGE | FLAG.TUNNEL));
      if (span) {
        const ya = h(this.gx[o0], this.gz[o0]) + lift;
        const yb = h(this.gx[o1 - 1], this.gz[o1 - 1]) + lift;
        const L = this.geomLen[g] || 1;
        for (let i = o0; i < o1; i++) this.gy[i] = ya + (yb - ya) * (this.geomCum[i] / L);
        // A bridge deck never dips below the ground under it.
        if (this.flags[e] & FLAG.BRIDGE) {
          for (let i = o0 + 1; i < o1 - 1; i++) {
            const gnd = h(this.gx[i], this.gz[i]) + lift;
            if (this.gy[i] < gnd) this.gy[i] = gnd;
          }
        }
      } else {
        for (let i = o0; i < o1; i++) this.gy[i] = h(this.gx[i], this.gz[i]) + lift;
      }
    }
    for (let i = 0; i < this.nodeCount; i++) this.nodeY[i] = h(this.nodeX[i], this.nodeZ[i]) + lift;
    // Nodes at bridge ends take the deck height so vehicles don't step.
    for (let e = 0; e < this.edgeCount; e++) {
      if (!(this.flags[e] & FLAG.BRIDGE)) continue;
      const g = this.geom[e];
      const o0 = this.geomOff[g];
      const o1 = this.geomOff[g + 1] - 1;
      const a = this.dir[e] > 0 ? this.from[e] : this.to[e];
      const b = this.dir[e] > 0 ? this.to[e] : this.from[e];
      this.nodeY[a] = this.gy[o0];
      this.nodeY[b] = this.gy[o1];
    }
  }
}

// Trees near the camera. Buncombe County is mostly forest, so close views need real canopy:
// instanced deciduous and evergreen trees are scattered on a jittered grid around the view,
// thinned by NLCD land cover, kept off roads and buildings, and colored by season and elevation
// (the same leaf timing as the terrain shader). The patch is rebuilt as the camera moves.

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { FLAG } from '../sim/graph.js';

const RADIUS = 1700;
const SPACING = 11;
const CELL = 4; // mask resolution (m)
// NLCD class -> [tree density, evergreen share]
const DENSITY = { 41: [0.8, 0.05], 42: [0.8, 0.9], 43: [0.8, 0.45], 90: [0.5, 0.3], 52: [0.22, 0.3], 21: [0.14, 0.25], 22: [0.08, 0.25],
  23: [0.03, 0.2], 24: [0.01, 0.2], 71: [0.04, 0.2], 81: [0.02, 0.3], 82: [0.01, 0.2], 31: [0.03, 0.5] };

function hash(a, b) {
  let h = Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function deciduousGeo() {
  const g = new GeoBuilder({ color: true });
  g.color(rgb('#4a3626')).cylinder(0, 0, 0.06, 0.045, 0, 0.42, 5, false);
  const canopy = new THREE.IcosahedronGeometry(1, 1);
  const pos = canopy.getAttribute('position');
  const out = g.build();
  // Merge the canopy (unit sphere at y = 0.62, slightly flattened) into the trunk geometry.
  const merged = new THREE.BufferGeometry();
  const tp = out.getAttribute('position').array;
  const tc = out.getAttribute('color').array;
  const tn = out.getAttribute('normal').array;
  const cp = [];
  const cc = [];
  const cn = [];
  const n = canopy.getAttribute('normal');
  for (let i = 0; i < pos.count; i++) {
    // Slightly lumpy, flattened crown.
    const px = pos.getX(i); const py = pos.getY(i); const pz = pos.getZ(i);
    const lump = 1 + 0.12 * Math.sin(px * 5.1 + pz * 3.7) * Math.cos(py * 4.3);
    cp.push(px * 0.5 * lump, 0.64 + py * 0.36 * lump, pz * 0.5 * lump);
    cn.push(n.getX(i), n.getY(i), n.getZ(i));
    cc.push(1, 1, 1);
  }
  const idxT = Array.from(out.getIndex().array);
  const baseC = tp.length / 3;
  const idxC = canopy.getIndex() ? Array.from(canopy.getIndex().array).map((v) => v + baseC) : [...Array(pos.count).keys()].map((v) => v + baseC);
  merged.setAttribute('position', new THREE.Float32BufferAttribute([...tp, ...cp], 3));
  merged.setAttribute('normal', new THREE.Float32BufferAttribute([...tn, ...cn], 3));
  merged.setAttribute('color', new THREE.Float32BufferAttribute([...tc, ...cc], 3));
  merged.setIndex([...idxT, ...idxC]);
  return merged;
}

function evergreenGeo() {
  const g = new GeoBuilder({ color: true });
  g.color(rgb('#3d2c20')).cylinder(0, 0, 0.05, 0.04, 0, 0.25, 5, false);
  g.color([1, 1, 1]);
  g.cylinder(0, 0, 0.42, 0.02, 0.18, 0.62, 8, false);
  g.cylinder(0, 0, 0.32, 0.02, 0.45, 0.85, 8, false);
  g.cylinder(0, 0, 0.2, 0.0, 0.7, 1.0, 8, false);
  return g.build();
}

export class TreeLayer {
  constructor(data, terrain, maxTrees = 60000) {
    this.data = data;
    this.terrain = terrain; // TerrainView (heightAt) + data.terrain (land cover)
    this.group = new THREE.Group();
    this.group.name = 'trees';
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
    this.dec = new THREE.InstancedMesh(deciduousGeo(), mat, maxTrees);
    this.eve = new THREE.InstancedMesh(evergreenGeo(), mat, Math.floor(maxTrees * 0.6));
    for (const m of [this.dec, this.eve]) {
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(m);
    }
    this.center = null;
    this.doy = -1;
    this.maxTrees = maxTrees;
    this.mask = null;
  }

  /** Rebuild the patch when the view has moved far enough or the season changed. */
  update(focus, camHeight, doy, snow) {
    const show = camHeight < 3200;
    this.group.visible = show;
    if (!show) return;
    const moved = !this.center || Math.hypot(focus.x - this.center.x, focus.z - this.center.z) > RADIUS * 0.3;
    if (!moved && Math.abs(doy - this.doy) < 3 && Math.abs((snow || 0) - (this.snow || 0)) < 0.2) return;
    this.center = { x: focus.x, z: focus.z };
    this.doy = doy;
    this.snow = snow || 0;
    this.build();
  }

  buildMask(cx, cz) {
    const W = Math.ceil((2 * RADIUS) / CELL);
    const mask = this.mask && this.mask.length === W * W ? this.mask : new Uint8Array(W * W);
    mask.fill(0);
    const x0 = cx - RADIUS;
    const z0 = cz - RADIUS;
    const mark = (x, z, r) => {
      const c0 = Math.max(0, Math.floor((x - r - x0) / CELL));
      const c1 = Math.min(W - 1, Math.floor((x + r - x0) / CELL));
      const r0 = Math.max(0, Math.floor((z - r - z0) / CELL));
      const r1 = Math.min(W - 1, Math.floor((z + r - z0) / CELL));
      for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) mask[j * W + i] = 1;
    };
    const net = this.data.roads;
    for (let g = 0; g < net.geomCount; g++) {
      const o0 = net.geomOff[g];
      const o1 = net.geomOff[g + 1];
      const e = net.geomEdge[g];
      if (e < 0 || net.flags[e] & FLAG.TUNNEL) continue;
      const mid = o0 + ((o1 - o0) >> 1);
      if (Math.abs(net.gx[mid] - cx) > RADIUS + 3000 || Math.abs(net.gz[mid] - cz) > RADIUS + 3000) continue;
      const hw = (net.geomLanesFwd[g] + net.geomLanesBwd[g]) * 1.8 + 3;
      for (let i = o0; i < o1 - 1; i++) {
        const ax = net.gx[i]; const az = net.gz[i];
        const bx = net.gx[i + 1]; const bz = net.gz[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        const steps = Math.max(1, Math.ceil(L / 3));
        for (let k = 0; k <= steps; k++) {
          const x = ax + ((bx - ax) * k) / steps;
          const z = az + ((bz - az) * k) / steps;
          if (Math.abs(x - cx) < RADIUS && Math.abs(z - cz) < RADIUS) mark(x, z, hw);
        }
      }
    }
    const b = this.data.buildings;
    b.forEachNear(cx, cz, RADIUS * 1.42, (i) => mark(b.x[i], b.z[i], Math.sqrt(b.area[i] / Math.PI) + 3));
    this.mask = mask;
    return { W, x0, z0 };
  }

  build() {
    const { x: cx, z: cz } = this.center;
    const { W, x0, z0 } = this.buildMask(cx, cz);
    const terr = this.data.terrain;
    const heightAt = (x, z) => this.terrain.heightAt(x, z);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sc = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const col = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    let nd = 0;
    let ne = 0;
    const gi0 = Math.floor((cx - RADIUS) / SPACING);
    const gi1 = Math.floor((cx + RADIUS) / SPACING);
    const gj0 = Math.floor((cz - RADIUS) / SPACING);
    const gj1 = Math.floor((cz + RADIUS) / SPACING);
    const doy = this.doy;
    for (let gj = gj0; gj <= gj1; gj++) {
      for (let gi = gi0; gi <= gi1; gi++) {
        const h1 = hash(gi, gj);
        const x = (gi + 0.15 + hash(gi * 7 + 1, gj) * 0.7) * SPACING;
        const z = (gj + 0.15 + hash(gi, gj * 7 + 3) * 0.7) * SPACING;
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
        const lc = terr.landcoverAt(x, z);
        const dens = DENSITY[lc];
        if (!dens || h1 > dens[0]) continue;
        const mi = Math.floor((x - x0) / CELL);
        const mj = Math.floor((z - z0) / CELL);
        if (mi < 0 || mj < 0 || mi >= W || mj >= W || this.mask[mj * W + mi]) continue;
        const evergreen = hash(gi * 3 + 11, gj * 5 + 7) < dens[1];
        const y = heightAt(x, z);
        const hgt = (evergreen ? 12 : 12) + hash(gi * 13, gj * 17) * (evergreen ? 12 : 10);
        const wid = hgt * (evergreen ? 0.36 : 0.52) * (0.8 + hash(gi * 19, gj * 23) * 0.4);
        pos.set(x, y - 0.4, z);
        q.setFromAxisAngle(yAxis, h1 * Math.PI * 2);
        sc.set(wid, hgt, wid);
        m4.compose(pos, q, sc);
        this.leafColor(col, evergreen, y, x, z, doy, gi, gj);
        if (evergreen && ne < this.eve.instanceMatrix.count) {
          this.eve.setMatrixAt(ne, m4);
          this.eve.setColorAt(ne, col);
          ne++;
        } else if (!evergreen && nd < this.maxTrees) {
          this.dec.setMatrixAt(nd, m4);
          this.dec.setColorAt(nd, col);
          nd++;
        }
      }
    }
    this.dec.count = nd;
    this.eve.count = ne;
    for (const m of [this.dec, this.eve]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.count = nd + ne;
  }

  /** Leaf color for the date and elevation (mirrors the terrain shader's timing). */
  leafColor(out, evergreen, elevM, x, z, doy, gi, gj) {
    if (this.snow > 0.3) {
      out.setRGB(0.75, 0.78, 0.8);
      if (evergreen) out.lerp(new THREE.Color(0.16, 0.24, 0.16), 0.5);
      return out;
    }
    if (evergreen) return out.setRGB(0.07 + hash(gi, gj) * 0.04, 0.16 + hash(gj, gi) * 0.05, 0.08);
    const ft = elevM * 3.281;
    const peak = 293 - ((ft - 2100) / 1000) * 7.5 + (hash(gi >> 3, gj >> 3) - 0.5) * 14;
    const s = Math.min(1, Math.max(0, (doy - (peak - 24)) / 24));
    const drop = Math.min(1, Math.max(0, (doy - (peak + 10)) / 20));
    const greenUp = 105 + ((ft - 2000) / 1000) * 6;
    const leafOut = Math.min(1, Math.max(0, (doy - greenUp + 5) / 27)) * (1 - Math.min(1, Math.max(0, (doy - peak - 10) / 28)));
    const summer = [0.1, 0.2, 0.06];
    const pick = hash(gi * 31 + 5, gj * 29 + 9);
    const fall = pick < 0.18 ? [0.36, 0.06, 0.03] : pick < 0.4 ? [0.46, 0.15, 0.03] : pick < 0.6 ? [0.42, 0.29, 0.05] : pick < 0.8 ? [0.2, 0.09, 0.04] : summer;
    const k = s * s * (3 - 2 * s);
    const brown = [0.2, 0.1, 0.05];
    let r = summer[0] + (fall[0] + (brown[0] - fall[0]) * drop - summer[0]) * k;
    let g = summer[1] + (fall[1] + (brown[1] - fall[1]) * drop - summer[1]) * k;
    let b = summer[2] + (fall[2] + (brown[2] - fall[2]) * drop - summer[2]) * k;
    const bare = [0.16, 0.12, 0.1];
    r = bare[0] + (r - bare[0]) * leafOut;
    g = bare[1] + (g - bare[1]) * leafOut;
    b = bare[2] + (b - bare[2]) * leafOut;
    return out.setRGB(r, g, b);
  }
}

// All 184,954 buildings, extruded from their real footprints. Houses with near-rectangular
// footprints get pitched roofs; everything else is flat-roofed with procedural windows that
// light up on a schedule by use. Geometry is batched in 3 km tiles and built progressively,
// nearest tiles first, so the county appears in a couple of seconds without a long stall.
//
// Per building, a float data texture holds color, window style, use and roof type; a byte
// texture holds an overlay color so any census or simulation value can paint the buildings.

import * as THREE from 'three';
import { ShapeUtils } from 'three';
import { createBuildingMaterial } from './materials.js';
import { KIND } from '../data/worldData.js';

const TILE = 3000;
const TEX_W = 1024;

// Kind -> [palette (sRGB hex), window style, lit-schedule use, shopfront]
const STYLE = {
  [KIND.HOUSE]: [['#e9e4d8', '#d8cfbd', '#c9c3b6', '#b7c0c4', '#a9b6a0', '#d5c4a1', '#9c6b56', '#e6e2da', '#8a9aa4', '#c2a68a'], 4, 1, 0],
  [KIND.TOWNHOME]: [['#d6cdbd', '#c4b8a4', '#a47e6a', '#bfc3c0'], 4, 1, 0],
  [KIND.CONDO]: [['#cfc6b6', '#b9ae9c', '#9c7f6c', '#c8ccc8'], 3, 1, 0],
  [KIND.APARTMENT]: [['#cdbfa8', '#bfb39e', '#a98b74', '#c6c0b4', '#9e7764'], 3, 1, 0],
  [KIND.MOBILE_HOME]: [['#e2e0d8', '#cfd4d6', '#d9d0bd', '#bcc6c2'], 4, 1, 0],
  [KIND.GROUP_QUARTERS]: [['#b9a48c', '#a8907a', '#c4b8a6'], 3, 1, 0],
  [KIND.HOTEL]: [['#c9bba3', '#b8b2a8', '#9b8572'], 3, 1, 0],
  [KIND.RETAIL]: [['#d2c7b3', '#c0b6a4', '#b3a58e', '#a99f93'], 5, 2, 1],
  [KIND.OFFICE]: [['#9eaab3', '#b5b0a5', '#8f9aa1', '#c2bcb0'], 2, 0, 0],
  [KIND.COMMERCIAL]: [['#c8bfae', '#b7ad9b', '#a69d8d'], 5, 2, 1],
  [KIND.INDUSTRIAL]: [['#b8b9b4', '#a7aaa8', '#c4c1b8'], 6, 3, 0],
  [KIND.WAREHOUSE]: [['#bebfba', '#adaea9', '#9ea2a3'], 6, 3, 0],
  [KIND.SCHOOL]: [['#a5644f', '#b07a5f', '#c2a283'], 2, 0, 0],
  [KIND.UNIVERSITY]: [['#a86a52', '#b98d6c', '#c9b393'], 2, 0, 0],
  [KIND.CHURCH]: [['#a35b46', '#e6e1d6', '#b29a7c'], 5, 4, 0],
  [KIND.HOSPITAL]: [['#d4d0c6', '#c2c4c0', '#b5b9b6'], 2, 4, 0],
  [KIND.MEDICAL]: [['#c9c6bc', '#b6b8b2'], 2, 0, 0],
  [KIND.GOVERNMENT]: [['#c4b9a4', '#b3a68e', '#d0cbbe'], 3, 0, 0],
  [KIND.CIVIC]: [['#bfae94', '#c9c0ae', '#a88f74'], 5, 4, 0],
  [KIND.RECREATION]: [['#b9b6a8', '#a6a99c'], 6, 2, 0],
  [KIND.PARKING]: [['#a9a69e', '#9d9b95'], 2, 3, 0],
  [KIND.FARM]: [['#8d3b2c', '#7a6a58', '#9a9184', '#6e5a48'], 0, 3, 0],
  [KIND.ACCESSORY]: [['#8f8a80', '#a39d90', '#7d756a', '#b5ab98', '#6d6459'], 0, 3, 0],
  [KIND.UTILITY]: [['#9fa3a2', '#b4b5ae'], 0, 3, 0],
  [KIND.MIXED_USE]: [['#b69a7c', '#a8826a', '#c4b49a', '#9d6d58'], 3, 2, 1],
  [KIND.OTHER]: [['#b9b2a4', '#a9a294', '#c3bcae'], 3, 2, 0],
};

function hash(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class BuildingView {
  /**
   * @param {import('../data/worldData.js').Buildings} b
   * @param {(x: number, z: number) => number} heightAt terrain surface sampler
   */
  constructor(b, heightAt) {
    this.b = b;
    this.heightAt = heightAt;
    this.group = new THREE.Group();
    this.group.name = 'buildings';
    const rows = Math.ceil(b.count / TEX_W);
    this.data = new Float32Array(TEX_W * rows * 4);
    this.over = new Uint8Array(TEX_W * rows * 4);
    this.dataTex = new THREE.DataTexture(this.data, TEX_W, rows, THREE.RGBAFormat, THREE.FloatType);
    this.overTex = new THREE.DataTexture(this.over, TEX_W, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.material = createBuildingMaterial(this.dataTex, this.overTex, TEX_W);
    this.fillData();
    // Tiles of building indices, built progressively.
    const tiles = new Map();
    for (let i = 0; i < b.count; i++) {
      const key = `${Math.floor(b.x[i] / TILE)},${Math.floor(b.z[i] / TILE)}`;
      let t = tiles.get(key);
      if (!t) {
        t = { key, list: [], cx: (Math.floor(b.x[i] / TILE) + 0.5) * TILE, cz: (Math.floor(b.z[i] / TILE) + 0.5) * TILE, mesh: null };
        tiles.set(key, t);
      }
      t.list.push(i);
    }
    this.tiles = [...tiles.values()];
    this.pending = [];
    this.done = 0;
  }

  fillData() {
    const b = this.b;
    const d = this.data;
    const col = new THREE.Color();
    for (let i = 0; i < b.count; i++) {
      const st = STYLE[b.kind[i]] || STYLE[KIND.OTHER];
      const pal = st[0];
      col.set(pal[Math.floor(hash(i) * pal.length) % pal.length]);
      const r = Math.round(col.r * 255);
      const g = Math.round(col.g * 255);
      const bl = Math.round(col.b * 255);
      let style = st[1];
      const h = b.height(i);
      if ((b.kind[i] === KIND.OFFICE || b.kind[i] === KIND.HOTEL) && h > 30) style = 1;
      if (b.kind[i] === KIND.HOUSE && b.area[i] < 45) style = 0;
      const code = style + 8 * st[2] + 64 * st[3];
      const roofKind = b.roof[i] ? (hash(i * 7 + 3) < 0.82 ? 1 : 2) : (b.area[i] > 1500 && hash(i * 3) < 0.6 ? 3 : 0);
      const o = i * 4;
      d[o] = r * 65536 + g * 256 + bl;
      d[o + 1] = code;
      d[o + 2] = b.roof[i] ? h : Math.max(2, h - 1.0);
      d[o + 3] = roofKind;
    }
    this.dataTex.needsUpdate = true;
  }

  /** Queue every tile, nearest to (x, z) first. */
  start(x, z) {
    this.pending = this.tiles.filter((t) => !t.mesh).sort((a, c) => (a.cx - x) ** 2 + (a.cz - z) ** 2 - ((c.cx - x) ** 2 + (c.cz - z) ** 2));
  }

  /** Build queued tiles for up to `budgetMs`. Returns the fraction built. */
  buildSome(budgetMs = 12) {
    const t0 = performance.now();
    while (this.pending.length && performance.now() - t0 < budgetMs) {
      const t = this.pending.shift();
      t.mesh = this.buildTile(t.list);
      this.group.add(t.mesh);
      this.done += t.list.length;
    }
    return this.done / this.b.count;
  }

  get complete() {
    return this.pending.length === 0;
  }

  buildTile(list) {
    const b = this.b;
    const pos = [];
    const fac = [];
    const bid = [];
    const idx = [];
    let n = 0;
    const v = (x, y, z, u, w, id) => {
      pos.push(x, y, z);
      fac.push(u, w);
      bid.push(id);
      return n++;
    };
    const ring = [];
    for (const i of list) {
      const o0 = b.ringOff[i];
      const o1 = b.ringOff[i + 1];
      const cnt = o1 - o0;
      if (cnt < 3) continue;
      ring.length = 0;
      let ground = Infinity;
      for (let k = o0; k < o1; k++) {
        const x = b.x[i] + b.ringX[k] / 10;
        const z = b.z[i] + b.ringZ[k] / 10;
        ring.push(x, z);
        const g = this.heightAt(x, z);
        if (g < ground) ground = g;
      }
      const base = ground - 0.6;
      b.base[i] = ground;
      const h = b.height(i);
      if (b.roof[i]) this.gableHouse(i, ring, base, ground + h, v, idx);
      else this.prism(i, ring, base, ground + h, v, idx);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aFac', new THREE.Float32BufferAttribute(fac, 2));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(bid, 1));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, this.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** Flat-roofed extrusion of the footprint (CCW in x,z). */
  prism(i, ring, y0, y1, v, idx) {
    const cnt = ring.length / 2;
    const hgt = y1 - y0;
    const bot = [];
    const top = [];
    let u = 0;
    for (let k = 0; k <= cnt; k++) {
      const kk = k % cnt;
      const x = ring[kk * 2];
      const z = ring[kk * 2 + 1];
      if (k > 0) u += Math.hypot(x - ring[((k - 1) % cnt) * 2], z - ring[((k - 1) % cnt) * 2 + 1]);
      bot.push(v(x, y0, z, u, 0, i));
      top.push(v(x, y1, z, u, hgt, i));
    }
    for (let k = 0; k < cnt; k++) idx.push(bot[k], top[k + 1], bot[k + 1], bot[k], top[k], top[k + 1]);
    // Roof: fan for convex footprints, ear clipping otherwise.
    if (cnt === 4 || isConvex(ring)) {
      for (let k = 1; k < cnt - 1; k++) idx.push(top[0], top[k + 1], top[k]);
    } else {
      const contour = [];
      for (let k = 0; k < cnt; k++) contour.push(new THREE.Vector2(ring[k * 2], ring[k * 2 + 1]));
      const tris = ShapeUtils.triangulateShape(contour, []);
      for (const [a, c, d] of tris) {
        // triangulateShape keeps the contour's orientation; flip if a triangle faces down.
        const ax = ring[a * 2]; const az = ring[a * 2 + 1];
        const cross = (ring[c * 2] - ax) * (ring[d * 2 + 1] - az) - (ring[c * 2 + 1] - az) * (ring[d * 2] - ax);
        if (cross > 0) idx.push(top[a], top[d], top[c]);
        else idx.push(top[a], top[c], top[d]);
      }
    }
  }

  /** Pitched roof over the footprint's oriented rectangle (houses, barns, sheds). */
  gableHouse(i, ring, y0, y1, v, idx) {
    const b = this.b;
    const th = (b.gable[i] / 127) * Math.PI;
    const ax = Math.cos(th);
    const az = Math.sin(th);
    const bx = -az;
    const bz = ax;
    let s0 = Infinity; let s1 = -Infinity; let t0 = Infinity; let t1 = -Infinity;
    const cx = b.x[i];
    const cz = b.z[i];
    for (let k = 0; k < ring.length; k += 2) {
      const px = ring[k] - cx;
      const pz = ring[k + 1] - cz;
      const s = px * ax + pz * az;
      const t = px * bx + pz * bz;
      if (s < s0) s0 = s;
      if (s > s1) s1 = s;
      if (t < t0) t0 = t;
      if (t > t1) t1 = t;
    }
    const P = (s, t) => [cx + ax * s + bx * t, cz + az * s + bz * t];
    const rect = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)].flat();
    const half = (t1 - t0) / 2;
    const rise = Math.min(4.5, half * 0.62);
    // Walls of the rectangle up to the eaves.
    this.prismWalls(i, rect, y0, y1, v, idx);
    const tm = (t0 + t1) / 2;
    const o = 0.45;
    const drop = (o * rise) / Math.max(half, 0.5);
    const hgt = y1 - y0;
    const W = (s, t, y) => {
      const [x, z] = P(s, t);
      return v(x, y, z, 0, hgt + 10, i); // above wTop: no windows on roofs/gables
    };
    // Two roof planes (each a quad), wound to face up and out.
    const e0 = W(s0 - 0.3, t0 - o, y1 - drop);
    const e1 = W(s1 + 0.3, t0 - o, y1 - drop);
    const r1 = W(s1 + 0.3, tm, y1 + rise);
    const r0 = W(s0 - 0.3, tm, y1 + rise);
    idx.push(e0, r1, e1, e0, r0, r1);
    const f0 = W(s0 - 0.3, t1 + o, y1 - drop);
    const f1 = W(s1 + 0.3, t1 + o, y1 - drop);
    const q1 = W(s1 + 0.3, tm, y1 + rise);
    const q0 = W(s0 - 0.3, tm, y1 + rise);
    idx.push(f0, f1, q1, f0, q1, q0);
    // Gable ends (wall color; facade v below wTop so they shade like walls but windowless).
    const G = (s, t, y) => {
      const [x, z] = P(s, t);
      return v(x, y, z, 0, hgt + 10, i);
    };
    const ga = G(s0, t0, y1); const gb = G(s0, t1, y1); const gc = G(s0, tm, y1 + rise);
    idx.push(ga, gb, gc);
    const ha = G(s1, t0, y1); const hb = G(s1, t1, y1); const hc = G(s1, tm, y1 + rise);
    idx.push(ha, hc, hb);
  }

  prismWalls(i, ring, y0, y1, v, idx) {
    const cnt = ring.length / 2;
    const hgt = y1 - y0;
    const bot = [];
    const top = [];
    let u = 0;
    for (let k = 0; k <= cnt; k++) {
      const kk = k % cnt;
      const x = ring[kk * 2];
      const z = ring[kk * 2 + 1];
      if (k > 0) u += Math.hypot(x - ring[((k - 1) % cnt) * 2], z - ring[((k - 1) % cnt) * 2 + 1]);
      bot.push(v(x, y0, z, u, 0, i));
      top.push(v(x, y1, z, u, hgt, i));
    }
    for (let k = 0; k < cnt; k++) idx.push(bot[k], top[k + 1], bot[k + 1], bot[k], top[k], top[k + 1]);
  }

  /**
   * Paint buildings with overlay colors. `colorOf(i)` returns [r, g, b, a] (0-255) or null.
   * Pass null to clear.
   */
  setOverlay(colorOf) {
    const o = this.over;
    o.fill(0);
    if (colorOf) {
      for (let i = 0; i < this.b.count; i++) {
        const c = colorOf(i);
        if (!c) continue;
        o[i * 4] = c[0];
        o[i * 4 + 1] = c[1];
        o[i * 4 + 2] = c[2];
        o[i * 4 + 3] = c[3];
      }
    }
    if (this.selected >= 0) this.markSelected(this.selected, true);
    this.overTex.needsUpdate = true;
  }

  /** Highlight one building (selection). */
  select(i) {
    if (this.selected >= 0 && this.selected !== i) this.markSelected(this.selected, false);
    this.selected = i;
    if (i >= 0) this.markSelected(i, true);
    this.overTex.needsUpdate = true;
  }

  markSelected(i, on) {
    const o = this.over;
    if (on) {
      this.saved = [o[i * 4], o[i * 4 + 1], o[i * 4 + 2], o[i * 4 + 3]];
      o[i * 4] = 255; o[i * 4 + 1] = 200; o[i * 4 + 2] = 40; o[i * 4 + 3] = 210;
    } else if (this.saved) {
      [o[i * 4], o[i * 4 + 1], o[i * 4 + 2], o[i * 4 + 3]] = this.saved;
    }
  }
}

function isConvex(ring) {
  const n = ring.length / 2;
  let sign = 0;
  for (let k = 0; k < n; k++) {
    const ax = ring[k * 2]; const az = ring[k * 2 + 1];
    const bx = ring[((k + 1) % n) * 2]; const bz = ring[((k + 1) % n) * 2 + 1];
    const cx = ring[((k + 2) % n) * 2]; const cz = ring[((k + 2) % n) * 2 + 1];
    const cr = (bx - ax) * (cz - bz) - (bz - az) * (cx - bx);
    if (Math.abs(cr) < 1e-6) continue;
    const s = cr > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

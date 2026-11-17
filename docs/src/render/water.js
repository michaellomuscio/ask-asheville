// Rivers, lakes and railways. River polygons follow the valley floor (the French Broad drops
// ~100 m across the county), lakes sit flat at their lowest shore, creeks and rivers without
// polygons are ribbons, and the Norfolk Southern lines are dark ballast strips.

import * as THREE from 'three';
import { ShapeUtils } from 'three';
import { createWaterMaterial } from './materials.js';

export function buildWater(bundle, heightAt) {
  const group = new THREE.Group();
  group.name = 'water';
  const a = bundle.arrays;
  const waterMat = createWaterMaterial();
  const pos = [];
  const idx = [];
  // Rings grouped into polygons (outer ring first, then holes).
  const polys = new Map();
  for (let r = 0; r < a.ring_poly.length; r++) {
    const p = a.ring_poly[r];
    if (!polys.has(p)) polys.set(p, []);
    polys.get(p).push(r);
  }
  for (const [p, rings] of polys) {
    const river = a.poly_kind[p] === 1;
    const contour = [];
    const holes = [];
    for (const r of rings) {
      const pts = [];
      for (let k = a.ring_off[r]; k < a.ring_off[r + 1]; k++) pts.push(new THREE.Vector2(a.px[k], a.pz[k]));
      if (a.ring_hole[r]) holes.push(pts);
      else contour.push(...pts);
    }
    if (contour.length < 3) continue;
    let tris;
    try {
      tris = ShapeUtils.triangulateShape(contour, holes);
    } catch {
      continue;
    }
    const all = contour.concat(...holes);
    let level = Infinity;
    if (!river) for (const q of contour) level = Math.min(level, heightAt(q.x, q.y));
    const base = pos.length / 3;
    for (const q of all) pos.push(q.x, river ? heightAt(q.x, q.y) - 0.4 : level + 0.05, q.y);
    for (const [i, j, k] of tris) {
      const ax = all[i].x; const az = all[i].y;
      const cr = (all[j].x - ax) * (all[k].y - az) - (all[j].y - az) * (all[k].x - ax);
      if (cr > 0) idx.push(base + i, base + k, base + j);
      else idx.push(base + i, base + j, base + k);
    }
  }
  const lines = { river: { pos: [], idx: [] }, rail: { pos: [], idx: [] } };
  for (let l = 0; l < a.line_w.length; l++) {
    const kind = a.line_kind[l] === 0 ? 'river' : 'rail';
    const L = lines[kind];
    const hw = a.line_w[l] / 2;
    const o0 = a.line_off[l];
    const o1 = a.line_off[l + 1];
    if (o1 - o0 < 2) continue;
    const base = L.pos.length / 3;
    for (let i = o0; i < o1; i++) {
      const ip = i > o0 ? i - 1 : i;
      const inx = i < o1 - 1 ? i + 1 : i;
      let tx = a.lx[inx] - a.lx[ip];
      let tz = a.lz[inx] - a.lz[ip];
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const sx = -tz * hw;
      const sz = tx * hw;
      const yOff = kind === 'river' ? -0.3 : 0.25;
      L.pos.push(a.lx[i] - sx, heightAt(a.lx[i] - sx, a.lz[i] - sz) + yOff, a.lz[i] - sz);
      L.pos.push(a.lx[i] + sx, heightAt(a.lx[i] + sx, a.lz[i] + sz) + yOff, a.lz[i] + sz);
    }
    for (let k = 0; k < o1 - o0 - 1; k++) {
      const q = base + k * 2;
      L.idx.push(q, q + 1, q + 2, q + 1, q + 3, q + 2);
    }
  }
  const mk = (p, ix, mat, name) => {
    if (!ix.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(ix, 1) : new THREE.Uint16BufferAttribute(ix, 1));
    g.computeVertexNormals();
    // Water and rails are horizontal enough; force up normals for clean lighting.
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    group.add(m);
  };
  mk(pos, idx, waterMat, 'lakes-rivers');
  mk(lines.river.pos, lines.river.idx, waterMat, 'streams');
  const railMat = new THREE.MeshStandardMaterial({ color: 0x4a443d, roughness: 0.95 });
  railMat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.y += 0.2;`);
  };
  mk(lines.rail.pos, lines.rail.idx, railMat, 'railways');
  return { group, waterMat };
}

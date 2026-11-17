// Data overlays on the ground and the buildings:
//   - census areas colored by any metric (block groups, blocks or ZIP codes), with an optional
//     range filter that dims every area outside it;
//   - drive-time heat maps from per-node times (to the destination, to a school, emergency
//     coverage...), drawn on the terrain through a nearest-road raster and on the roads.
// Areas are colored through an id raster (block id in RG, ZIP in B) and small lookup textures,
// so switching metrics or filters only rewrites a few thousand texels.

import * as THREE from 'three';

const LUT_W = 128;
const LUT_H = 64;
const NEAR_CELL = 40;
const NEAR_R = 360;

// Sequential palette (low -> high), tuned to read on green terrain in light and dark.
export const SEQ = ['#2e1f63', '#4b3593', '#5f58b8', '#3f8fb0', '#2fb39a', '#8fcf6b', '#e8d55a', '#ffb347'];
export const DIV = ['#b2354a', '#df7a5e', '#f3c7a3', '#eeeeee', '#a8d8cf', '#4fae9e', '#1e6f73'];

const fmtUsd = (v) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 10000 ? `$${Math.round(v / 1000)}K` : `$${Math.round(v).toLocaleString('en-US')}`);
export function formatValue(v, unit) {
  if (v === null || v === undefined || !Number.isFinite(v)) return 'n/a';
  if (unit === 'usd') return fmtUsd(v);
  if (unit === 'pct') return `${(v * 100).toFixed(v < 0.1 && v > -0.1 ? 1 : 0)}%`;
  if (unit === 'year') return v <= 1939 ? 'before 1940' : String(Math.round(v));
  if (unit === 'years') return v.toFixed(1);
  if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('en-US');
  return v.toFixed(v < 10 ? 2 : 1);
}

/** An id raster as a nearest-filtered texture plus its pixels for CPU lookups. */
async function loadIdRaster(url) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = url;
  });
  const tex = new THREE.Texture(img);
  tex.flipY = false;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.premultiplyAlpha = false;
  tex.needsUpdate = true;
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { tex, pixels: ctx.getImageData(0, 0, img.width, img.height).data };
}

function hexToRgb(hex) {
  const c = new THREE.Color(hex);
  return [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255)];
}

export class Overlays {
  constructor(data, terrain, roads, buildings) {
    this.data = data;
    this.terrain = terrain;
    this.roads = roads;
    this.buildings = buildings;
    this.areas = data.areas;
    this.metricById = Object.fromEntries(this.areas.metrics.map((m) => [m.id, m]));
    this.lut = new Uint8Array(LUT_W * LUT_H * 4);
    this.lutTex = new THREE.DataTexture(this.lut, LUT_W, LUT_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.lutTex.colorSpace = THREE.SRGBColorSpace;
    this.group = new Uint8Array(LUT_W * LUT_H * 4);
    this.groupTex = new THREE.DataTexture(this.group, LUT_W, LUT_H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.metric = null;
    this.legend = null;
    this.heat = null;
  }

  async init(base) {
    const main = await loadIdRaster(base + 'areas_id.png');
    this.idTex = main.tex;
    this.idPixels = main.pixels;
    this.terrain.setAreaTextures(main.tex, this.lutTex, this.groupTex);
    const u = this.terrain.material.userData.uniforms;
    u.uNodeTime.value = this.roads.nodeTimeTex;
    u.uNodeW.value = this.roads.nodeW;
  }

  /** Geography under a point: {block, bg, zip} indices (or -1); keys match metric.geo. */
  areaAt(x, z) {
    const none = { block: -1, bg: -1, zip: -1 };
    const r = this.areas.raster;
    const px = Math.floor((x - r.x0) / r.cell);
    const pz = Math.floor((z - r.z0) / r.cell);
    if (px < 0 || pz < 0 || px >= r.width || pz >= r.height) return none;
    const o = (pz * r.width + px) * 4;
    const d = this.idPixels;
    if (d[o + 3] < 128) return none;
    const block = d[o] + d[o + 1] * 256 - 1;
    const zip = d[o + 2] - 1;
    return { block, bg: block >= 0 ? this.areas.block.bg[block] : -1, zip };
  }

  /** Values of a metric per geography unit (array) and its unit/geo. */
  valuesOf(id) {
    const m = this.metricById[id];
    if (!m) return null;
    return { m, values: this.areas[m.geo][id] };
  }

  /**
   * Color the map by a metric. opts.filter = [lo, hi] dims areas outside the range;
   * opts.buildings paints buildings with their area's color.
   */
  setMetric(id, opts = {}) {
    const u = this.terrain.material.userData.uniforms;
    this.highlight = null;
    if (!id) {
      this.metric = null;
      this.legend = null;
      u.uOverlay.value = this.heat ? 2 : 0;
      this.buildings.setOverlay(null);
      return null;
    }
    const { m, values } = this.valuesOf(id);
    const finite = values.filter((v) => v !== null && Number.isFinite(v)).sort((a, b) => a - b);
    const diverging = false;
    const pal = diverging ? DIV : SEQ;
    // Quantile breaks (7 classes) for skewed data; equal steps for diverging.
    const k = pal.length;
    const breaks = [];
    if (diverging) {
      const ext = Math.max(Math.abs(finite[0] || 0), Math.abs(finite[finite.length - 1] || 0));
      for (let i = 1; i < k; i++) breaks.push(-ext + (2 * ext * i) / k);
    } else {
      for (let i = 1; i < k; i++) breaks.push(finite[Math.min(finite.length - 1, Math.floor((finite.length * i) / k))]);
    }
    const classOf = (v) => {
      let c = 0;
      while (c < breaks.length && v > breaks[c]) c++;
      return c;
    };
    const rgb = pal.map(hexToRgb);
    const filter = opts.filter || null;
    const pass = (v) => !filter || (v >= filter[0] && v <= filter[1]);
    const lut = this.lut;
    lut.fill(0);
    const grp = this.group;
    grp.fill(0);
    const nBlocks = this.areas.block.geoid.length;
    const unitColor = new Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v === null || !Number.isFinite(v)) unitColor[i] = null;
      else unitColor[i] = [...rgb[classOf(v)], pass(v) ? 255 : 0];
    }
    const setKey = (key, c, group) => {
      const o = key * 4;
      if (c && c[3]) {
        lut[o] = c[0]; lut[o + 1] = c[1]; lut[o + 2] = c[2]; lut[o + 3] = 235;
      } else if (c) {
        // Outside the filter range: darken so the matching areas stand out.
        lut[o] = 22; lut[o + 1] = 25; lut[o + 2] = 32; lut[o + 3] = 150;
      } else {
        lut[o] = 90; lut[o + 1] = 90; lut[o + 2] = 90; lut[o + 3] = 50;
      }
      grp[o] = group & 255;
      grp[o + 1] = (group >> 8) & 255;
    };
    if (m.geo === 'zip') {
      for (let z = 0; z < values.length; z++) setKey(z + 1, unitColor[z], z + 1);
      u.uAreaMode.value = 2;
    } else {
      for (let b = 0; b < nBlocks; b++) {
        const unit = m.geo === 'bg' ? this.areas.block.bg[b] : b;
        setKey(b + 1, unitColor[unit], unit + 1);
      }
      u.uAreaMode.value = 1;
    }
    this.lutTex.needsUpdate = true;
    this.groupTex.needsUpdate = true;
    u.uOverlay.value = 1;
    this.areaOpacity = opts.opacity ?? 0.72;
    u.uOverlayOpacity.value = this.areaOpacity;
    this.metric = id;
    // Buildings take their area's color (filtered-out areas stay plain).
    if (opts.buildings) {
      const b = this.data.buildings;
      const unitOf = m.geo === 'zip' ? this.buildingUnits(m.geo) : null;
      this.buildings.setOverlay((i) => {
        const unit = m.geo === 'bg' ? b.bg[i] : m.geo === 'block' ? b.block[i] : unitOf[i];
        const c = unit >= 0 ? unitColor[unit] : null;
        return c && c[3] ? [c[0], c[1], c[2], 190] : null;
      });
    } else {
      this.buildings.setOverlay(null);
    }
    const minV = finite[0];
    const maxV = finite[finite.length - 1];
    const bins = rgb.map((c, i) => ({
      color: pal[i],
      from: i === 0 ? minV : breaks[i - 1],
      to: i === k - 1 ? maxV : breaks[i],
    }));
    // Population living in the areas that pass the filter.
    let popIn = 0;
    let popAll = 0;
    if (m.geo !== 'zip') {
      const pop = this.areas.block.pop;
      for (let b = 0; b < nBlocks; b++) {
        const unit = m.geo === 'bg' ? this.areas.block.bg[b] : b;
        popAll += pop[b];
        const v = values[unit];
        if (v !== null && Number.isFinite(v) && pass(v)) popIn += pop[b];
      }
    }
    this.legend = { metric: m, bins, min: minV, max: maxV, values: finite, filter, popIn, popAll };
    return this.legend;
  }

  /**
   * Outline a set of Census blocks (a town, the area around a place) and dim everything else.
   * `blocks` is an iterable of block indices; `label` names the area in the legend.
   */
  setHighlight(blocks, label, color = '#ffc93c') {
    const u = this.terrain.material.userData.uniforms;
    const rgb = hexToRgb(color);
    const lut = this.lut;
    const grp = this.group;
    lut.fill(0);
    grp.fill(0);
    const inside = new Set(blocks);
    const nBlocks = this.areas.block.geoid.length;
    for (let b = 0; b < nBlocks; b++) {
      const o = (b + 1) * 4;
      if (inside.has(b)) {
        lut[o] = rgb[0]; lut[o + 1] = rgb[1]; lut[o + 2] = rgb[2]; lut[o + 3] = 70;
        grp[o] = 1;
      } else {
        lut[o] = 14; lut[o + 1] = 17; lut[o + 2] = 24; lut[o + 3] = 120;
        grp[o] = 2;
      }
    }
    this.lutTex.needsUpdate = true;
    this.groupTex.needsUpdate = true;
    u.uAreaMode.value = 1;
    u.uOverlay.value = 1;
    u.uOverlayOpacity.value = 0.9;
    this.metric = null;
    this.legend = null;
    this.highlight = { label, count: inside.size, color };
    this.buildings.setOverlay(null);
  }

  clearHighlight() {
    if (!this.highlight) return;
    this.highlight = null;
    const u = this.terrain.material.userData.uniforms;
    if (!this.metric) u.uOverlay.value = this.heat ? 2 : 0;
  }

  /** ZIP index of every building (computed once). */
  buildingUnits(geo) {
    this._units ||= {};
    if (this._units[geo]) return this._units[geo];
    const b = this.data.buildings;
    const out = new Int16Array(b.count);
    for (let i = 0; i < b.count; i++) out[i] = this.areaAt(b.x[i], b.z[i])[geo];
    this._units[geo] = out;
    return out;
  }

  // --- Drive-time heat maps -------------------------------------------------------------------

  ensureNearRaster() {
    if (this.nearTex) return;
    const net = this.data.roads;
    const bx = net.bounds;
    const x0 = bx.x0 - NEAR_R;
    const z0 = bx.z0 - NEAR_R;
    const W = Math.ceil((bx.x1 - bx.x0 + 2 * NEAR_R) / NEAR_CELL);
    const H = Math.ceil((bx.z1 - bx.z0 + 2 * NEAR_R) / NEAR_CELL);
    const best = new Float32Array(W * H).fill(Infinity);
    const node = new Int32Array(W * H).fill(-1);
    const r = Math.ceil(NEAR_R / NEAR_CELL);
    // Only nodes on ordinary streets can be "reached from" a spot of ground.
    const ok = new Uint8Array(net.nodeCount);
    for (let e = 0; e < net.edgeCount; e++) {
      if (net.cls[e] > 3) {
        ok[net.from[e]] = 1;
        ok[net.to[e]] = 1;
      }
    }
    for (let i = 0; i < net.nodeCount; i++) {
      if (!ok[i]) continue;
      const nx = net.nodeX[i];
      const nz = net.nodeZ[i];
      const cx = Math.floor((nx - x0) / NEAR_CELL);
      const cz = Math.floor((nz - z0) / NEAR_CELL);
      for (let dz = -r; dz <= r; dz++) {
        const zz = cz + dz;
        if (zz < 0 || zz >= H) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = cx + dx;
          if (xx < 0 || xx >= W) continue;
          const px = x0 + (xx + 0.5) * NEAR_CELL;
          const pz = z0 + (zz + 0.5) * NEAR_CELL;
          const d = (px - nx) ** 2 + (pz - nz) ** 2;
          const o = zz * W + xx;
          if (d < best[o]) {
            best[o] = d;
            node[o] = i;
          }
        }
      }
    }
    const px = new Uint8Array(W * H * 4);
    for (let o = 0; o < W * H; o++) {
      const n = node[o];
      const d = Math.sqrt(best[o]);
      if (n < 0 || d > NEAR_R) {
        px[o * 4 + 3] = 255;
        continue;
      }
      px[o * 4] = n & 255;
      px[o * 4 + 1] = (n >> 8) & 255;
      px[o * 4 + 2] = (n >> 16) & 255;
      px[o * 4 + 3] = Math.min(254, Math.round(d));
    }
    this.nearTex = new THREE.DataTexture(px, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.nearTex.needsUpdate = true;
    const u = this.terrain.material.userData.uniforms;
    u.uNear.value = this.nearTex;
    u.uNearOrigin.value.set(x0, z0);
    u.uNearSize.value.set(W * NEAR_CELL, H * NEAR_CELL);
    u.uNearDim.value.set(W, H);
  }

  /**
   * Show drive times (seconds per node). opts: {maxMinutes, bandMinutes, title, subtitle, onRoads}.
   */
  showHeat(times, opts = {}) {
    this.ensureNearRaster();
    const maxS = (opts.maxMinutes ?? 45) * 60;
    const bandS = (opts.bandMinutes ?? 5) * 60;
    this.roads.setNodeTimes(times, maxS, bandS);
    const u = this.terrain.material.userData.uniforms;
    u.uTimeMax.value = maxS;
    u.uBand.value = bandS;
    this.highlight = null;
    u.uOverlay.value = 2;
    u.uOverlayOpacity.value = opts.opacity ?? 0.52;
    if (opts.onRoads !== false) this.roads.setMode('time');
    this.heat = { times, ...opts, maxS, bandS };
  }

  clearHeat() {
    this.heat = null;
    this.roads.setNodeTimes(null);
    this.roads.setMode(this.roadMode || 'plain');
    const u = this.terrain.material.userData.uniforms;
    u.uOverlay.value = this.metric || this.highlight ? 1 : 0;
    // The area colors share one opacity setting with the heat map; put the layer's back.
    if (this.metric) u.uOverlayOpacity.value = this.areaOpacity ?? 0.72;
  }

  setRoadMode(mode) {
    this.roadMode = mode;
    if (!this.heat) this.roads.setMode(mode);
  }
}

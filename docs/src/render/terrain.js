// The ground: Buncombe County's real terrain (USGS 3DEP, 30 m) as chunked meshes at 60 m
// with a 180 m level of detail for distant chunks. Shading comes from textures at the full
// 30 m: land cover (NLCD), per-pixel normals, seasonal foliage that turns in October from the
// ridgetops down, snow, and the data overlays (census areas, drive-time heat maps).
//
// heightAt(x, z) reproduces the near mesh exactly (same triangles), so roads, buildings and
// vehicles sit on the surface you see.

import * as THREE from 'three';
import { shared, HASH } from './materials.js';

const CHUNK = 96; // quads per chunk side at the base stride
const BASE = 2; // base stride over the 30 m grid -> 60 m quads
const FAR = 6; // stride for distant chunks -> 180 m
const NEAR_DIST = 9000; // chunks closer than this (m, from the camera) use the base mesh
const SKIRT = 40;

// NLCD land cover -> summer color (sRGB) and deciduous share.
const LAND = {
  11: ['#3b5d70', 0], 12: ['#e8eef2', 0], 21: ['#8ea36a', 0.25], 22: ['#959583', 0.2], 23: ['#999387', 0.1], 24: ['#8b8781', 0.05],
  31: ['#998e7c', 0], 41: ['#3e5a2a', 1], 42: ['#2b472b', 0.08], 43: ['#395430', 0.6], 52: ['#6c7146', 0.3], 71: ['#88985a', 0],
  81: ['#9ba65e', 0], 82: ['#a6995d', 0], 90: ['#435638', 0.5], 95: ['#6a7d55', 0],
};

export class TerrainView {
  /** @param {import('../data/worldData.js').Terrain} terrain */
  constructor(terrain, areas) {
    this.t = terrain;
    this.areas = areas;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    const nx = terrain.nx;
    const nz = terrain.nz;
    this.gw = Math.floor((nx - 1) / BASE) + 1;
    this.gh = Math.floor((nz - 1) / BASE) + 1;
    this.step = terrain.cell * BASE;
    this.x0 = terrain.x0;
    this.z0 = terrain.z0;
    // Heights at the base stride (the mesh's vertices).
    this.H = new Float32Array(this.gw * this.gh);
    for (let j = 0; j < this.gh; j++) {
      for (let i = 0; i < this.gw; i++) this.H[j * this.gw + i] = terrain.height[(j * BASE) * nx + i * BASE];
    }
    this.buildTextures();
    this.material = this.createMaterial();
    this.chunks = [];
    const cxN = Math.ceil((this.gw - 1) / CHUNK);
    const czN = Math.ceil((this.gh - 1) / CHUNK);
    for (let cz = 0; cz < czN; cz++) {
      for (let cx = 0; cx < cxN; cx++) {
        const i0 = cx * CHUNK;
        const j0 = cz * CHUNK;
        const i1 = Math.min(this.gw - 1, i0 + CHUNK);
        const j1 = Math.min(this.gh - 1, j0 + CHUNK);
        const ch = { i0, j0, i1, j1, near: null, far: null, center: new THREE.Vector3(), radius: 0 };
        const xa = this.x0 + i0 * this.step;
        const xb = this.x0 + i1 * this.step;
        const za = this.z0 + j0 * this.step;
        const zb = this.z0 + j1 * this.step;
        let hmin = Infinity;
        let hmax = -Infinity;
        for (let j = j0; j <= j1; j += 4) {
          for (let i = i0; i <= i1; i += 4) {
            const h = this.H[j * this.gw + i];
            if (h < hmin) hmin = h;
            if (h > hmax) hmax = h;
          }
        }
        ch.center.set((xa + xb) / 2, (hmin + hmax) / 2, (za + zb) / 2);
        ch.radius = Math.hypot(xb - xa, zb - za, hmax - hmin) / 2;
        ch.far = this.buildChunk(ch, FAR / BASE);
        this.group.add(ch.far);
        this.chunks.push(ch);
      }
    }
    this._v = new THREE.Vector3();
  }

  /** Height of the rendered surface at (x, z): same triangles as the base mesh. */
  heightAt(x, z) {
    let fx = (x - this.x0) / this.step;
    let fz = (z - this.z0) / this.step;
    let i = Math.floor(fx);
    let j = Math.floor(fz);
    if (i < 0) { i = 0; fx = 0; } else if (i > this.gw - 2) { i = this.gw - 2; fx = this.gw - 1; }
    if (j < 0) { j = 0; fz = 0; } else if (j > this.gh - 2) { j = this.gh - 2; fz = this.gh - 1; }
    const u = Math.min(1, Math.max(0, fx - i));
    const v = Math.min(1, Math.max(0, fz - j));
    const o = j * this.gw + i;
    const h00 = this.H[o];
    const h10 = this.H[o + 1];
    const h01 = this.H[o + this.gw];
    const h11 = this.H[o + this.gw + 1];
    // Quad split along (i,j)-(i+1,j+1): u >= v is the triangle with (i+1, j).
    if (u >= v) return h00 + (h10 - h00) * u + (h11 - h10) * v;
    return h00 + (h11 - h01) * u + (h01 - h00) * v;
  }

  buildChunk(ch, stride) {
    const s = stride;
    const ni = Math.floor((ch.i1 - ch.i0) / s);
    const nj = Math.floor((ch.j1 - ch.j0) / s);
    const cols = ni + 1;
    const rows = nj + 1;
    const vcount = cols * rows + 2 * (cols + rows);
    const pos = new Float32Array(vcount * 3);
    const nor = new Float32Array(vcount * 3);
    let k = 0;
    const put = (i, j, drop) => {
      const ii = Math.min(this.gw - 1, i);
      const jj = Math.min(this.gh - 1, j);
      pos[k * 3] = this.x0 + ii * this.step;
      pos[k * 3 + 1] = this.H[jj * this.gw + ii] - drop;
      pos[k * 3 + 2] = this.z0 + jj * this.step;
      nor[k * 3 + 1] = 1;
      return k++;
    };
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) put(ch.i0 + c * s, ch.j0 + r * s, 0);
    const idx = [];
    for (let r = 0; r < nj; r++) {
      for (let c = 0; c < ni; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        idx.push(a, e, b, a, d, e);
      }
    }
    // Skirts hide the cracks between near and far chunks.
    const skirt = (list) => {
      const first = k;
      for (const [i, j] of list) put(i, j, SKIRT);
      for (let q = 0; q < list.length - 1; q++) {
        const top0 = list[q][2];
        const top1 = list[q + 1][2];
        const bot0 = first + q;
        const bot1 = first + q + 1;
        idx.push(top0, bot0, top1, top1, bot0, bot1);
        idx.push(top0, top1, bot0, top1, bot1, bot0);
      }
    };
    const north = []; const south = []; const west = []; const east = [];
    for (let c = 0; c < cols; c++) {
      north.push([ch.i0 + c * s, ch.j0, c]);
      south.push([ch.i0 + c * s, ch.j0 + nj * s, nj * cols + c]);
    }
    for (let r = 0; r < rows; r++) {
      west.push([ch.i0, ch.j0 + r * s, r * cols]);
      east.push([ch.i0 + ni * s, ch.j0 + r * s, r * cols + ni]);
    }
    skirt(north); skirt(south); skirt(west); skirt(east);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    g.setIndex(k > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(ch.center.clone(), ch.radius + 50);
    const mesh = new THREE.Mesh(g, this.material);
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  /** Swap chunks between the near (60 m) and far (180 m) meshes by distance to the camera. */
  update(camera) {
    const cp = camera.position;
    let built = 0;
    for (const ch of this.chunks) {
      const d = Math.max(0, cp.distanceTo(ch.center) - ch.radius);
      const wantNear = d < NEAR_DIST;
      if (wantNear && !ch.near && built < 2) {
        ch.near = this.buildChunk(ch, 1);
        this.group.add(ch.near);
        built++;
      }
      if (ch.near) ch.near.visible = wantNear;
      ch.far.visible = !(wantNear && ch.near);
      if (!wantNear && ch.near && d > NEAR_DIST * 1.8) {
        this.group.remove(ch.near);
        ch.near.geometry.dispose();
        ch.near = null;
      }
    }
  }

  // --- Textures ---------------------------------------------------------------------------------

  buildTextures() {
    const t = this.t;
    const nx = t.nx;
    const nz = t.nz;
    // Land color + deciduous share.
    const land = new Uint8Array(nx * nz * 4);
    const lut = {};
    for (const [code, [hex, dec]] of Object.entries(LAND)) {
      const c = new THREE.Color(hex);
      lut[code] = [Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), Math.round(dec * 255)];
    }
    const def = lut[43];
    for (let i = 0; i < nx * nz; i++) {
      const v = lut[t.landcover[i]] || def;
      land[i * 4] = v[0];
      land[i * 4 + 1] = v[1];
      land[i * 4 + 2] = v[2];
      land[i * 4 + 3] = v[3];
    }
    this.landTex = new THREE.DataTexture(land, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.landTex.colorSpace = THREE.SRGBColorSpace;
    this.landTex.magFilter = THREE.LinearFilter;
    this.landTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.landTex.generateMipmaps = true;
    this.landTex.anisotropy = 8;
    this.landTex.needsUpdate = true;
    // Normals from the full 30 m grid (x and z components; y is rebuilt in the shader).
    const nrm = new Uint8Array(nx * nz * 4);
    const h = t.height;
    const c2 = 2 * t.cell;
    for (let j = 0; j < nz; j++) {
      const jm = j > 0 ? j - 1 : j;
      const jp = j < nz - 1 ? j + 1 : j;
      for (let i = 0; i < nx; i++) {
        const im = i > 0 ? i - 1 : i;
        const ip = i < nx - 1 ? i + 1 : i;
        const dx = (h[j * nx + ip] - h[j * nx + im]) / c2;
        const dz = (h[jp * nx + i] - h[jm * nx + i]) / c2;
        const l = Math.hypot(dx, 1, dz);
        const o = (j * nx + i) * 4;
        nrm[o] = Math.round((-dx / l * 0.5 + 0.5) * 255);
        nrm[o + 1] = Math.round((-dz / l * 0.5 + 0.5) * 255);
        nrm[o + 2] = Math.min(255, Math.round(Math.hypot(dx, dz) * 255));
        nrm[o + 3] = Math.round(Math.min(1, Math.max(0, (h[j * nx + i] - 300) / 1800)) * 255);
      }
    }
    this.normTex = new THREE.DataTexture(nrm, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.normTex.magFilter = THREE.LinearFilter;
    this.normTex.minFilter = THREE.LinearMipmapLinearFilter;
    this.normTex.generateMipmaps = true;
    this.normTex.needsUpdate = true;
  }

  createMaterial() {
    const t = this.t;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    const ar = this.areas.raster;
    const u = {
      uLand: { value: this.landTex },
      uNorm: { value: this.normTex },
      uTerrOrigin: { value: new THREE.Vector2(t.x0 - t.cell / 2, t.z0 - t.cell / 2) },
      uTerrSize: { value: new THREE.Vector2(t.nx * t.cell, t.nz * t.cell) },
      uAreaId: { value: null },
      uAreaOrigin: { value: new THREE.Vector2(ar.x0, ar.z0) },
      uAreaSize: { value: new THREE.Vector2(ar.width * ar.cell, ar.height * ar.cell) },
      uAreaTexel: { value: new THREE.Vector2(1 / ar.width, 1 / ar.height) },
      uAreaLut: { value: null },
      uAreaGroup: { value: null },
      uLutW: { value: 128 },
      uAreaMode: { value: 0 }, // 0 off, 1 blocks/bg (via block id), 2 zip
      uOverlay: { value: 0 }, // 0 none, 1 area, 2 heat
      uOverlayOpacity: { value: 0.7 },
      uBorders: { value: 1 },
      uNear: { value: null },
      uNearOrigin: { value: new THREE.Vector2() },
      uNearSize: { value: new THREE.Vector2(1, 1) },
      uNearDim: { value: new THREE.Vector2(1, 1) },
      uNodeTime: { value: null },
      uNodeW: { value: 256 },
      uTimeMax: { value: 3600 },
      uBand: { value: 300 },
      uOffroad: { value: 6 },
      uCounty: { value: 1 },
    };
    mat.userData.uniforms = u;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, u);
      shader.uniforms.uDoy = shared.uDoy;
      shader.uniforms.uSnow = shared.uSnow;
      shader.uniforms.uWet = shared.uWet;
      shader.uniforms.uNight = shared.uNight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
varying vec3 vWorldT;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWorldT = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vWorldT;
uniform sampler2D uLand;
uniform sampler2D uNorm;
uniform vec2 uTerrOrigin;
uniform vec2 uTerrSize;
uniform sampler2D uAreaId;
uniform vec2 uAreaOrigin;
uniform vec2 uAreaSize;
uniform vec2 uAreaTexel;
uniform sampler2D uAreaLut;
uniform sampler2D uAreaGroup;
uniform float uLutW;
uniform float uAreaMode;
uniform float uOverlay;
uniform float uOverlayOpacity;
uniform float uBorders;
uniform sampler2D uNear;
uniform vec2 uNearOrigin;
uniform vec2 uNearSize;
uniform vec2 uNearDim;
uniform highp sampler2D uNodeTime;
uniform float uNodeW;
uniform float uTimeMax;
uniform float uBand;
uniform float uOffroad;
uniform float uCounty;
uniform float uDoy;
uniform float uSnow;
uniform float uWet;
uniform float uNight;
${HASH}
int areaKeyAt(vec2 uv) {
  vec4 idc = texture2D(uAreaId, uv);
  int blk = int(idc.r * 255.0 + 0.5) + int(idc.g * 255.0 + 0.5) * 256;
  int zip = int(idc.b * 255.0 + 0.5);
  return uAreaMode > 1.5 ? zip : blk;
}
vec4 lutAt(int key) {
  return texelFetch(uAreaLut, ivec2(key % int(uLutW), key / int(uLutW)), 0);
}
float groupAt(int key) {
  vec4 g = texelFetch(uAreaGroup, ivec2(key % int(uLutW), key / int(uLutW)), 0);
  return g.r * 255.0 + g.g * 255.0 * 256.0;
}
float nodeTime(int i) {
  return texelFetch(uNodeTime, ivec2(i % int(uNodeW), i / int(uNodeW)), 0).r;
}
float cellTime(ivec2 c) {
  vec4 nn = texelFetch(uNear, c, 0);
  if (nn.a > 0.995) return 1e9;
  int node = int(nn.r * 255.0 + 0.5) + int(nn.g * 255.0 + 0.5) * 256 + int(nn.b * 255.0 + 0.5) * 65536;
  float tn = nodeTime(node);
  return tn + nn.a * 255.0 * 1.4 / uOffroad;
}
vec3 rampTime(float t) {
  // sRGB stops converted to linear: teal (close) -> gold -> red -> plum (far).
  vec3 a = pow(vec3(0.07, 0.55, 0.52), vec3(2.2));
  vec3 b = pow(vec3(0.98, 0.80, 0.30), vec3(2.2));
  vec3 c = pow(vec3(0.78, 0.13, 0.18), vec3(2.2));
  vec3 d = pow(vec3(0.35, 0.05, 0.22), vec3(2.2));
  if (t < 0.45) return mix(a, b, t / 0.45);
  if (t < 0.8) return mix(b, c, (t - 0.45) / 0.35);
  return mix(c, d, (t - 0.8) / 0.2);
}
vec3 srgb(vec3 c) { return pow(c, vec3(2.2)); }
// Noise octave faded to its mean (0.5) once a pixel covers more than about half its period:
// otherwise far and top-down views shimmer with speckle.
float octave(vec2 p, float freq, float offset, float fw) {
  return mix(0.5, vnoise(p * freq + offset), 1.0 - smoothstep(0.3 / freq, 1.0 / freq, fw));
}
vec3 foliage(vec3 summer, float deciduous, float elevM, vec2 p) {
  float ft = elevM * 3.281;
  float peak = 293.0 - (ft - 2100.0) / 1000.0 * 7.5;
  float d = uDoy;
  float fw = length(fwidth(p));
  float n1 = octave(p, 0.035, 0.0, fw);
  float n3 = octave(p, 0.011, 7.7, fw);
  float jitter = (n1 - 0.5) * 10.0 + (n3 - 0.5) * 8.0;
  float s = (d - (peak - 24.0 + jitter)) / 24.0; // 0 = still green, 1 = peak color
  float drop = (d - (peak + 10.0 + jitter)) / 20.0; // leaves falling
  float greenUp = 105.0 + (ft - 2000.0) / 1000.0 * 6.0;
  float leafOut = smoothstep(greenUp - 5.0, greenUp + 22.0, d) * (1.0 - smoothstep(peak + 10.0, peak + 38.0, d));
  vec3 bare = srgb(vec3(0.40, 0.35, 0.31));
  vec3 spring = srgb(vec3(0.48, 0.62, 0.30));
  // Stand-by-stand variety: maples go red, hickories and poplars gold, oaks russet, some stay green.
  float pick = vnoise(p * 0.045 + 11.3) * 0.6 + vnoise(p * 0.16 + 2.7) * 0.4;
  vec3 fall = pick < 0.16 ? srgb(vec3(0.62, 0.15, 0.09)) : pick < 0.34 ? srgb(vec3(0.76, 0.38, 0.10))
            : pick < 0.52 ? srgb(vec3(0.74, 0.58, 0.16)) : pick < 0.7 ? srgb(vec3(0.46, 0.25, 0.12)) : summer;
  // From far away the stands blend into their average color instead of flickering between them.
  vec3 fallAvg = 0.16 * srgb(vec3(0.62, 0.15, 0.09)) + 0.18 * srgb(vec3(0.76, 0.38, 0.10)) + 0.18 * srgb(vec3(0.74, 0.58, 0.16))
               + 0.18 * srgb(vec3(0.46, 0.25, 0.12)) + 0.30 * summer;
  fall = mix(fall, fallAvg, smoothstep(2.0, 10.0, fw));
  vec3 leaf = summer;
  if (d < 175.0) leaf = mix(spring, summer, smoothstep(greenUp + 10.0, 170.0, d));
  float c = clamp(s, 0.0, 1.0);
  c = c * c * (3.0 - 2.0 * c) * (0.75 + 0.25 * n1);
  leaf = mix(leaf, mix(fall, srgb(vec3(0.42, 0.31, 0.22)), clamp(drop, 0.0, 1.0)), c);
  vec3 dec = mix(bare, leaf, leafOut);
  return mix(summer, dec, deciduous);
}`)
        .replace('#include <color_fragment>', `#include <color_fragment>
vec2 tuv = (vWorldT.xz - uTerrOrigin) / uTerrSize;
vec4 landS = texture2D(uLand, tuv);
vec4 nrmS = texture2D(uNorm, tuv);
vec3 col = landS.rgb;
vec2 p = vWorldT.xz;
col = foliage(col, landS.a, vWorldT.y, p);
float slope = nrmS.b;
// Rock shows through on the steepest slopes.
col = mix(col, srgb(vec3(0.46, 0.44, 0.41)), smoothstep(0.75, 1.1, slope) * 0.6);
float fwT = length(fwidth(p));
float tex = octave(p, 0.06, 0.0, fwT) * 0.5 + octave(p, 0.5, 0.0, fwT) * 0.3 + octave(p, 2.3, 0.0, fwT) * 0.2;
col *= mix(0.9, 1.07, tex);
// Snow: thicker on gentle ground and up high.
float snowAmt = uSnow * (1.0 - smoothstep(0.55, 1.0, slope)) * (0.75 + 0.25 * smoothstep(600.0, 1200.0, vWorldT.y));
col = mix(col, vec3(0.86, 0.89, 0.94), clamp(snowAmt, 0.0, 1.0));
col *= mix(1.0, 0.82, uWet);
vec2 auv = (vWorldT.xz - uAreaOrigin) / uAreaSize;
float inside = 0.0;
if (auv.x > 0.0 && auv.y > 0.0 && auv.x < 1.0 && auv.y < 1.0) {
  vec4 idc = texture2D(uAreaId, auv);
  inside = idc.a;
  if (uOverlay > 0.5 && uOverlay < 1.5 && inside > 0.5) {
    int key = areaKeyAt(auv);
    vec4 lc = lutAt(key);
    col = mix(col, lc.rgb, lc.a * uOverlayOpacity);
    if (uBorders > 0.5) {
      float g0 = groupAt(key);
      vec2 px = fwidth(auv) * 1.2;
      float edge = 0.0;
      edge += step(0.5, abs(groupAt(areaKeyAt(auv + vec2(px.x, 0.0))) - g0));
      edge += step(0.5, abs(groupAt(areaKeyAt(auv + vec2(0.0, px.y))) - g0));
      col = mix(col, vec3(1.0), clamp(edge, 0.0, 1.0) * 0.55);
    }
  }
  if (uCounty > 0.5) {
    vec2 px = fwidth(auv) * 1.5;
    float a1 = texture2D(uAreaId, auv + vec2(px.x, 0.0)).a;
    float a2 = texture2D(uAreaId, auv + vec2(0.0, px.y)).a;
    float edge = step(0.5, abs(a1 - inside)) + step(0.5, abs(a2 - inside));
    col = mix(col, vec3(0.98, 0.84, 0.3), clamp(edge, 0.0, 1.0) * 0.85);
  }
}
if (uOverlay > 1.5) {
  vec2 nuv = (vWorldT.xz - uNearOrigin) / uNearSize * uNearDim - 0.5;
  ivec2 c0 = ivec2(floor(nuv));
  vec2 f = fract(nuv);
  ivec2 maxc = ivec2(uNearDim) - 1;
  float t00 = cellTime(clamp(c0, ivec2(0), maxc));
  float t10 = cellTime(clamp(c0 + ivec2(1, 0), ivec2(0), maxc));
  float t01 = cellTime(clamp(c0 + ivec2(0, 1), ivec2(0), maxc));
  float t11 = cellTime(clamp(c0 + ivec2(1, 1), ivec2(0), maxc));
  float w00 = (1.0 - f.x) * (1.0 - f.y) * step(t00, 1e8);
  float w10 = f.x * (1.0 - f.y) * step(t10, 1e8);
  float w01 = (1.0 - f.x) * f.y * step(t01, 1e8);
  float w11 = f.x * f.y * step(t11, 1e8);
  float ws = w00 + w10 + w01 + w11;
  if (ws > 0.05) {
    float tt = (t00 * w00 + t10 * w10 + t01 * w01 + t11 * w11) / ws;
    vec3 rc = rampTime(clamp(tt / uTimeMax, 0.0, 1.0));
    float bandF = tt / uBand;
    float line = 1.0 - smoothstep(0.0, fwidth(bandF) * 1.4, abs(fract(bandF + 0.5) - 0.5));
    rc = mix(rc, vec3(1.0), line * 0.6);
    col = mix(col, rc, uOverlayOpacity * clamp(ws, 0.0, 1.0));
  }
}
if (uCounty > 0.5 && inside < 0.5) col *= 0.82;
diffuseColor.rgb = col;`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{
  vec2 nuv2 = (vWorldT.xz - uTerrOrigin) / uTerrSize;
  vec4 ns = texture2D(uNorm, nuv2);
  vec2 nxz = ns.rg * 2.0 - 1.0;
  vec3 nw = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
  normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);
}`);
    };
    mat.customProgramCacheKey = () => 'asv-terrain-v3';
    return mat;
  }

  setAreaTextures(idTex, lutTex, groupTex) {
    const u = this.material.userData.uniforms;
    u.uAreaId.value = idTex;
    u.uAreaLut.value = lutTex;
    u.uAreaGroup.value = groupTex;
  }
}

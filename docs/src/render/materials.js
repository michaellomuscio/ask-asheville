// Shared materials. Most extend MeshStandardMaterial through onBeforeCompile so they keep
// physically based lighting, shadows and fog while adding procedural detail: windows that
// light up at night, lane paint, fall color on the ridges, and the data overlays.

import * as THREE from 'three';

/** Uniforms shared by every material that reacts to time of day, season or weather. */
export const shared = {
  uTime: { value: 0 },
  uNight: { value: 0 }, // 0 = day, 1 = full night (artificial lights at full strength)
  uLit: { value: new THREE.Vector4(0.5, 0.5, 0.5, 0.5) }, // lit window share: office, residential, retail, industrial
  uLitCivic: { value: 0.5 },
  uWet: { value: 0 },
  uRain: { value: 0 },
  uSnow: { value: 0 }, // snow cover 0..1
  uDoy: { value: 280 }, // day of year (foliage)
  uCamPos: { value: new THREE.Vector3() },
  uPixelAngle: { value: 0.001 }, // radians per screen pixel (for minimum line widths)
};

export const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x), mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

// --- Buildings ------------------------------------------------------------------------------
//
// Per-vertex: aFac = facade coordinates in meters (u along the wall, v above the building base),
// aBid = building index. Per building (data texture uBData, RGBA32F): packed RGB color,
// style + 8*use + 64*shopfront, top of windows (m), roof style. uBOver (RGBA8) holds the data
// overlay color for each building (alpha = strength) and a selection flag.

const BUILDING_PARS = /* glsl */ `
uniform float uNight;
uniform vec4 uLit;
uniform float uLitCivic;
uniform float uTime;
uniform float uSnow;
varying vec2 vFac;
varying vec4 vInfo;
varying vec3 vWorldN;
varying vec4 vOver;
varying vec3 vRoofCol;
${HASH}
float pulseInt(float x, float a, float b) { return floor(x) * (b - a) + clamp(fract(x), a, b) - a; }
float fpulse(float x, float a, float b, float w) {
  w = max(w, 1e-4);
  return (pulseInt(x + 0.5 * w, a, b) - pulseInt(x - 0.5 * w, a, b)) / w;
}
`;

const BUILDING_FRAG = /* glsl */ `
  float wStyle = floor(vInfo.y + 0.5);
  float wCode = floor(vInfo.z + 0.5);
  float wUse = mod(wCode, 8.0);
  float wShop = step(7.5, wCode);
  float wTop = vInfo.w;
  float wSeed = floor(vInfo.x + 0.5);
  vec2 wSeed2 = vec2(mod(wSeed, 61.0), floor(wSeed / 61.0));
  vec3 wdx = dFdx(vWorldP);
  vec3 wdy = dFdy(vWorldP);
  vec3 faceN = normalize(cross(wdx, wdy));
  float isRoof = step(0.42, abs(faceN.y));
  float win = 0.0;
  float lit = 0.0;
  vec3 glassCol = vec3(0.05, 0.065, 0.08);
  vec3 litCol = vec3(1.0, 0.72, 0.42);
  float glassMetal = 0.6;
  float wallRough = 0.85;
  if (isRoof > 0.5) {
    diffuseColor.rgb = vRoofCol;
  } else if (wStyle > 0.5 && vFac.y < wTop + 0.01) {
    vec2 cell = vec2(3.0, 3.3);
    vec4 m = vec4(0.25, 0.75, 0.28, 0.82);
    if (wStyle < 1.5) { cell = vec2(1.6, 3.9); m = vec4(0.04, 0.96, 0.05, 0.95); glassMetal = 0.9; wallRough = 0.35; }
    else if (wStyle < 2.5) { cell = vec2(3.0, 3.7); m = vec4(0.0, 1.0, 0.3, 0.86); glassMetal = 0.8; wallRough = 0.7; }
    else if (wStyle < 3.5) { cell = vec2(3.0, 3.0); m = vec4(0.24, 0.76, 0.26, 0.8); }
    else if (wStyle < 4.5) { cell = vec2(3.6, 3.0); m = vec4(0.3, 0.7, 0.3, 0.75); wallRough = 0.9; }
    else if (wStyle < 5.5) { cell = vec2(2.2, 3.8); m = vec4(0.22, 0.78, 0.0, 1.0); wallRough = 0.75; }
    else if (wStyle < 6.5) { cell = vec2(6.0, 100.0); m = vec4(0.06, 0.94, 0.0, 1.0); wallRough = 0.6; }
    else { cell = vec2(6.0, 3.6); m = vec4(0.07, 0.93, 0.12, 1.0); }
    vec2 p = vFac / cell;
    vec2 fw = fwidth(p);
    vec2 id = floor(p);
    float wx = fpulse(p.x, m.x, m.y, fw.x);
    float wy = fpulse(p.y, m.z, m.w, fw.y);
    if (wStyle > 5.5 && wStyle < 6.5) {
      wy = smoothstep(wTop - 2.6, wTop - 2.4, vFac.y) * (1.0 - smoothstep(wTop - 1.1, wTop - 0.9, vFac.y));
      id.y = 0.0;
    }
    win = wx * wy;
    if (wShop > 0.5 && vFac.y < 4.2) {
      float sx = fpulse(vFac.x / 6.0, 0.06, 0.94, fwidth(vFac.x / 6.0));
      win = sx * smoothstep(0.35, 0.45, vFac.y) * (1.0 - smoothstep(3.3, 3.4, vFac.y));
      id = vec2(floor(vFac.x / 6.0), -1.0);
    }
    float fine = clamp(max(fw.x, fw.y) * 1.6 - 0.35, 0.0, 1.0);
    float h = hash12(id + wSeed2 * 17.0);
    float ratio = wUse < 0.5 ? uLit.x : wUse < 1.5 ? uLit.y : wUse < 2.5 ? uLit.z : wUse < 3.5 ? uLit.w : uLitCivic;
    if (wShop > 0.5 && vFac.y < 4.2) ratio = uLit.z;
    lit = mix(step(h, ratio), ratio, fine);
    float h2 = hash12(id.yx + wSeed2 * 23.0 + 5.0);
    litCol = h2 < 0.55 ? vec3(1.0, 0.7, 0.4) : h2 < 0.85 ? vec3(1.0, 0.86, 0.66) : h2 < 0.95 ? vec3(0.78, 0.88, 1.0) : vec3(0.55, 0.7, 1.0);
    litCol *= mix(0.55, 1.15, hash12(id + 3.7));
    litCol = mix(litCol, vec3(0.86, 0.66, 0.44), fine);
    if (wStyle < 1.5) {
      glassCol = diffuseColor.rgb * mix(mix(0.75, 1.15, hash12(id + wSeed2 * 7.0)), 0.95, fine);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.45, 0.48, 0.5), 0.6);
    } else {
      float hb = hash12(id + 11.0);
      glassCol = mix(vec3(0.03, 0.04, 0.055), vec3(0.1, 0.11, 0.12), hb);
      glassCol = mix(glassCol, vec3(0.52, 0.49, 0.43), step(0.8, hb) * 0.55);
      glassCol = mix(glassCol, vec3(0.1, 0.105, 0.11), fine);
    }
    win = clamp(win, 0.0, 1.0);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, glassCol, win);
  // Snow settles on roofs.
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.94, 0.97), uSnow * isRoof * 0.9);
  // Data overlay and selection.
  diffuseColor.rgb = mix(diffuseColor.rgb, vOver.rgb, vOver.a);
`;

export function createBuildingMaterial(dataTex, overTex, texWidth) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uLit = shared.uLit;
    shader.uniforms.uLitCivic = shared.uLitCivic;
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uSnow = shared.uSnow;
    shader.uniforms.uBData = { value: dataTex };
    shader.uniforms.uBOver = { value: overTex };
    shader.uniforms.uBWidth = { value: texWidth };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aFac;
attribute float aBid;
uniform highp sampler2D uBData;
uniform sampler2D uBOver;
uniform float uBWidth;
varying vec2 vFac;
varying vec4 vInfo;
varying vec3 vWorldP;
varying vec4 vOver;
varying vec3 vRoofCol;`)
      .replace('#include <color_vertex>', `#include <color_vertex>
{
  int bid = int(aBid + 0.5);
  ivec2 tc = ivec2(bid % int(uBWidth), bid / int(uBWidth));
  vec4 d = texelFetch(uBData, tc, 0);
  float packed = d.r;
  vec3 col = vec3(floor(packed / 65536.0), mod(floor(packed / 256.0), 256.0), mod(packed, 256.0)) / 255.0;
  vColor.rgb = col * col; // sRGB-ish to linear (works whether vColor is vec3 or vec4)
  float code = d.g;
  float style = mod(code, 8.0);
  float use = mod(floor(code / 8.0), 8.0);
  float shop = floor(code / 64.0);
  vInfo = vec4(float(bid), style, use + shop * 8.0, d.b);
  float roofKind = d.a;
  vRoofCol = roofKind < 0.5 ? vec3(0.16, 0.16, 0.17) : roofKind < 1.5 ? vec3(0.11, 0.1, 0.1) : roofKind < 2.5 ? vec3(0.25, 0.09, 0.07) : vec3(0.32, 0.33, 0.33);
  vOver = texelFetch(uBOver, tc, 0);
}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vFac = aFac;
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldP;
${BUILDING_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${BUILDING_FRAG}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(wStyle > 0.5 ? wallRough : roughnessFactor, 0.08, win);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, glassMetal, win);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += win * lit * litCol * 1.25 * uNight * uNight;
totalEmissiveRadiance += vOver.rgb * vOver.a * 0.18 * (0.4 + uNight);`);
  };
  mat.vertexColors = true;
  mat.customProgramCacheKey = () => 'asv-building-v1';
  return mat;
}

// --- Roads -----------------------------------------------------------------------------------
//
// Ribbons built along each polyline. position = centerline point; aSide = unit lateral vector
// (x, z); aRoad = (u meters along, v -1..1 across, half width m, packed info); aEnds = (node A,
// node B, fraction along, geometry id). Major roads widen with distance so the network stays
// legible from high above, like a map.

export function createRoadMaterial(opts) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0 });
  const u = {
    uMode: { value: 0 }, // 0 plain, 1 congestion, 2 drive time
    uGeomData: { value: opts.geomTex }, // RG: congestion ratio forward/backward per geometry
    uGeomW: { value: opts.geomW },
    uNodeTime: { value: opts.nodeTimeTex },
    uNodeW: { value: opts.nodeW },
    uTimeMax: { value: 3600 },
    uBand: { value: 300 },
    uHighlight: { value: -1 },
  };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.uniforms.uWet = shared.uWet;
    shader.uniforms.uSnow = shared.uSnow;
    shader.uniforms.uCamPos = shared.uCamPos;
    shader.uniforms.uPixelAngle = shared.uPixelAngle;
    shader.uniforms.uNight = shared.uNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec2 aSide;
attribute vec4 aRoad;
attribute vec4 aEnds;
uniform vec3 uCamPos;
uniform float uPixelAngle;
varying vec4 vRoad;
varying vec4 vEnds;
varying vec3 vWorldR;
varying float vScale;`)
      .replace('#include <begin_vertex>', `
vec3 transformed = vec3(position);
{
  float info = aRoad.w;
  float cls = mod(info, 16.0);
  float d = distance(position, uCamPos);
  float hw = aRoad.z;
  // Keep big roads at least ~1.3 px wide (local roads ~0.7 px) far away.
  float minPx = cls < 5.5 ? 1.3 : cls < 9.5 ? 0.7 : 0.0;
  float hwMin = d * uPixelAngle * minPx;
  float w = max(hw, hwMin);
  vScale = w / max(hw, 0.01);
  transformed.xz += aSide * aRoad.y * w;
  // Lift toward the camera a little so paint never sinks into the terrain.
  transformed.y += 0.25 + d * 0.0006;
}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vRoad = aRoad;
vEnds = aEnds;
vWorldR = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uMode;
uniform sampler2D uGeomData;
uniform float uGeomW;
uniform highp sampler2D uNodeTime;
uniform float uNodeW;
uniform float uTimeMax;
uniform float uBand;
uniform float uHighlight;
uniform float uWet;
uniform float uSnow;
uniform float uNight;
varying vec4 vRoad;
varying vec4 vEnds;
varying vec3 vWorldR;
varying float vScale;
${HASH}
vec3 rampTime(float t) {
  vec3 a = pow(vec3(0.07, 0.55, 0.52), vec3(2.2));
  vec3 b = pow(vec3(0.98, 0.80, 0.30), vec3(2.2));
  vec3 c = pow(vec3(0.78, 0.13, 0.18), vec3(2.2));
  vec3 d = pow(vec3(0.35, 0.05, 0.22), vec3(2.2));
  if (t < 0.45) return mix(a, b, t / 0.45);
  if (t < 0.8) return mix(b, c, (t - 0.45) / 0.35);
  return mix(c, d, (t - 0.8) / 0.2);
}
vec3 rampCongestion(float r) {
  float t = clamp((r - 1.0) / 1.5, 0.0, 1.0);
  vec3 g = pow(vec3(0.15, 0.78, 0.45), vec3(2.2));
  vec3 y = pow(vec3(1.0, 0.75, 0.15), vec3(2.2));
  vec3 rd = pow(vec3(0.86, 0.12, 0.14), vec3(2.2));
  return t < 0.4 ? mix(g, y, t / 0.4) : mix(y, rd, (t - 0.4) / 0.6);
}
float fetchNode(float id) {
  int i = int(id + 0.5);
  return texelFetch(uNodeTime, ivec2(i % int(uNodeW), i / int(uNodeW)), 0).r;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float info = vRoad.w;
  float cls = mod(info, 16.0);
  float lanesF = mod(floor(info / 16.0), 8.0);
  float lanesB = mod(floor(info / 128.0), 8.0);
  float bridge = mod(floor(info / 1024.0), 2.0);
  float v = vRoad.y;
  float hw = vRoad.z;
  float along = vRoad.x;
  vec3 asphalt = cls < 1.5 ? vec3(0.17, 0.175, 0.19) : cls < 9.5 ? vec3(0.21, 0.215, 0.225) : vec3(0.26, 0.26, 0.255);
  if (cls > 12.5) asphalt = vec3(0.30, 0.29, 0.27);
  float n = vnoise(vWorldR.xz * 0.9) * 0.5 + vnoise(vWorldR.xz * 0.11) * 0.5;
  vec3 col = asphalt * mix(0.88, 1.1, n);
  // Lane paint, faded out once a stripe is thinner than a pixel.
  float vm = v * hw; // meters from centerline
  float px = fwidth(vm);
  float paintFade = 1.0 - smoothstep(0.08, 0.35, px) ;
  float twoWay = step(0.5, lanesB) * step(0.5, lanesF);
  float lanesTot = lanesF + lanesB;
  if (paintFade > 0.0 && cls < 11.5) {
    float lineW = 0.12;
    float aa = max(px, 0.02);
    // Edge lines.
    float edge = 1.0 - smoothstep(lineW, lineW + aa, abs(abs(vm) - (hw - 0.45)));
    // Double yellow center line on two-way roads.
    float cy = twoWay * (1.0 - smoothstep(lineW, lineW + aa, abs(abs(vm) - 0.18)));
    // Dashed white lane lines.
    float dash = step(0.5, fract(along / 12.0)) ;
    float laneLine = 0.0;
    float lw = 3.4;
    for (int k = 1; k < 4; k++) {
      float fk = float(k);
      float side = twoWay > 0.5 ? (vm > 0.0 ? lanesF : lanesB) : lanesTot;
      if (fk < side) {
        float pos = twoWay > 0.5 ? fk * lw : (-lanesTot * 0.5 + fk) * lw;
        laneLine = max(laneLine, 1.0 - smoothstep(lineW, lineW + aa, abs(abs(twoWay > 0.5 ? abs(vm) : vm) - pos)));
      }
    }
    laneLine *= dash;
    col = mix(col, vec3(0.86, 0.86, 0.8), max(edge * step(4.5, hw), laneLine) * paintFade * (1.0 - uSnow));
    col = mix(col, vec3(0.88, 0.68, 0.12), cy * paintFade * (1.0 - uSnow));
  }
  if (bridge > 0.5) col *= 1.12;
  // Overlays.
  if (uMode > 0.5 && uMode < 1.5) {
    int g = int(vEnds.w + 0.5);
    vec2 cr = texelFetch(uGeomData, ivec2(g % int(uGeomW), g / int(uGeomW)), 0).rg;
    float ratio = 1.0 + (v >= 0.0 ? cr.r : cr.g) * 4.0;
    // Arterials and highways always show their state; local streets only when they back up.
    float show = cls < 9.5 ? 0.85 : smoothstep(1.08, 1.3, ratio) * 0.85;
    col = mix(col, rampCongestion(ratio) * 0.9, show);
  } else if (uMode > 1.5) {
    float ta = fetchNode(vEnds.x);
    float tb = fetchNode(vEnds.y);
    float t = mix(ta, tb, vEnds.z);
    if (t < 1e30) {
      vec3 rc = rampTime(clamp(t / uTimeMax, 0.0, 1.0));
      float band = floor(t / uBand);
      rc *= 0.92 + 0.08 * mod(band, 2.0);
      col = mix(col, rc, 0.9);
    } else {
      col *= 0.5;
    }
  }
  col = mix(col, vec3(0.86, 0.88, 0.92), uSnow * 0.75 * step(10.5, cls));
  diffuseColor.rgb = col * mix(1.0, 0.55, uWet);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.2, uWet);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uMode > 0.5) totalEmissiveRadiance += diffuseColor.rgb * (0.08 + 0.45 * uNight);
{
  // Streetlights: a warm wash on lit streets after dark (interstates are mostly unlit).
  float clsN = mod(vRoad.w, 16.0);
  float lit = clsN < 1.5 ? 0.15 : clsN < 9.5 ? 1.0 : clsN < 11.5 ? 0.55 : 0.25;
  totalEmissiveRadiance += vec3(1.0, 0.62, 0.32) * 0.035 * uNight * lit * (uMode > 0.5 ? 0.3 : 1.0);
}`);
  };
  mat.customProgramCacheKey = () => 'asv-road-v1';
  return mat;
}

// --- Water ----------------------------------------------------------------------------------

export function createWaterMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x1f3a3a, roughness: 0.08, metalness: 0.15, envMapIntensity: 1.1 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uRain = shared.uRain;
    shader.uniforms.uCamPos = shared.uCamPos;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
uniform vec3 uCamPos;
varying vec3 vWorldP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
transformed.y += 0.15 + distance(position, uCamPos) * 0.0004;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
vWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uTime;
uniform float uRain;
varying vec3 vWorldP;
${HASH}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  vec2 q = vWorldP.xz;
  float t = uTime;
  float e = 0.6;
  float n0 = vnoise(q * 0.08 + vec2(t * 0.05, t * 0.02)) + vnoise(q * 0.31 - vec2(t * 0.11, -t * 0.07)) * 0.5;
  float nx = vnoise((q + vec2(e, 0.0)) * 0.08 + vec2(t * 0.05, t * 0.02)) + vnoise((q + vec2(e, 0.0)) * 0.31 - vec2(t * 0.11, -t * 0.07)) * 0.5;
  float nz = vnoise((q + vec2(0.0, e)) * 0.08 + vec2(t * 0.05, t * 0.02)) + vnoise((q + vec2(0.0, e)) * 0.31 - vec2(t * 0.11, -t * 0.07)) * 0.5;
  float amp = 0.35 + uRain * 0.6;
  vec3 wn = normalize(vec3(-(nx - n0) * amp / e * 4.0, 1.0, -(nz - n0) * amp / e * 4.0));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`);
  };
  mat.customProgramCacheKey = () => 'asv-water-v1';
  return mat;
}

/** Soft radial glow texture for light pools, headlight beams and markers. */
export function glowTexture(size = 128, inner = 0.0, falloff = 1.6) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size * 2 - 1;
      const dy = (y + 0.5) / size * 2 - 1;
      const r = Math.hypot(dx, dy);
      const a = r < inner ? 1 : Math.max(0, 1 - (r - inner) / (1 - inner));
      const v = Math.round(255 * a ** falloff);
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = v;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Headlight beam: bright near the car, fading forward and to the sides. */
export function beamTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const v = (y + 0.5) / size * 2 - 1;
      const spread = 0.25 + u * 0.75;
      const across = Math.max(0, 1 - Math.abs(v) / spread);
      const along = Math.min(1, u * 8) * (1 - u) ** 1.4;
      const a = across ** 1.5 * along;
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * Math.min(1, a * 1.6));
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Vehicles. Near the camera they are Signal City's instanced models (body, trim, lights) plus
// school buses, semis, ambulances, fire engines and police cars with light bars; they pitch with
// the grade and pull toward the curb for sirens. Farther away every vehicle is a glowing point
// colored by speed or trip purpose, so the whole county's traffic stays visible and cheap.

import * as THREE from 'three';
import { GeoBuilder, rgb } from './geo.js';
import { shared, beamTexture, glowTexture } from './materials.js';

const GLASS = rgb('#1a2027');
const TIRE = rgb('#141414');
const TRIM = rgb('#2b2e32');
const CHROME = rgb('#9aa0a6');
const CARGO = rgb('#e6e5df');
// Light kinds (aInfo.x): 0 head, 1 tail, 2 sign, 3 left indicator, 4 right indicator, 5 red flasher, 6 blue flasher, 7 amber flasher.
const HEAD = 0; const TAIL = 1; const SIGN = 2; const IND_L = 3; const IND_R = 4; const RED = 5; const BLUE = 6; const AMBER = 7;

export const VEHICLE_SPECS = {
  sedan: { len: 4.6, wid: 1.85, h: 1.5 },
  hatch: { len: 4.0, wid: 1.75, h: 1.5 },
  suv: { len: 4.9, wid: 2.0, h: 1.8 },
  van: { len: 5.4, wid: 2.05, h: 2.3 },
  truck: { len: 7.6, wid: 2.4, h: 3.3 },
  semi: { len: 16.5, wid: 2.55, h: 4.0 },
  bus: { len: 11.8, wid: 2.55, h: 3.2 },
  schoolbus: { len: 11.0, wid: 2.45, h: 3.1 },
  ambulance: { len: 6.6, wid: 2.3, h: 2.9 },
  engine: { len: 10.5, wid: 2.5, h: 3.3 },
  police: { len: 5.0, wid: 1.95, h: 1.6 },
};
export const TYPE_NAMES = Object.keys(VEHICLE_SPECS);

function octagon(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

function wheels(trim, xs, halfW, r = 0.33, w = 0.24) {
  trim.color(TIRE);
  for (const x of xs) {
    for (const s of [-1, 1]) {
      const z0 = s > 0 ? halfW - w : -halfW;
      trim.prismZ(octagon(x, r, r), z0, z0 + w);
    }
  }
}

function lightBox(L, kind, x0, x1, y0, y1, z0, z1, col) {
  L.color(col).info(kind, 0, 0, 0);
  L.box(x0, x1, y0, y1, z0, z1, { bottom: false });
}

function standardLights(L, len, halfW, yHead, yTail, inset = 0.5) {
  const f = len / 2;
  for (const s of [-1, 1]) {
    const zi = s * (halfW - inset);
    const zo = s * (halfW - 0.12);
    lightBox(L, HEAD, f - 0.08, f + 0.03, yHead, yHead + 0.12, Math.min(zi, zo), Math.max(zi, zo), rgb('#fff6e6'));
    lightBox(L, TAIL, -f - 0.03, -f + 0.08, yTail, yTail + 0.14, Math.min(zi, zo), Math.max(zi, zo), rgb('#ff2a1a'));
    const zc0 = s * (halfW - 0.16);
    const zc1 = s * (halfW - 0.02);
    lightBox(L, s < 0 ? IND_L : IND_R, f - 0.1, f + 0.02, yHead - 0.12, yHead - 0.03, Math.min(zc0, zc1), Math.max(zc0, zc1), rgb('#ffb21e'));
    lightBox(L, s < 0 ? IND_L : IND_R, -f - 0.02, -f + 0.1, yTail - 0.12, yTail - 0.03, Math.min(zc0, zc1), Math.max(zc0, zc1), rgb('#ffb21e'));
  }
}

function lightBar(L, x0, x1, y, hw) {
  lightBox(L, RED, x0, x1, y, y + 0.16, -hw, -0.05, rgb('#ff2020'));
  lightBox(L, BLUE, x0, x1, y, y + 0.16, 0.05, hw, rgb('#2a5cff'));
}

function car(body, trim, lights, L, hw, kind) {
  const f = L / 2;
  const suv = kind === 'suv';
  const hatch = kind === 'hatch';
  const sill = suv ? 0.42 : 0.3;
  const belt = suv ? 1.02 : 0.82;
  const roof = suv ? 1.74 : hatch ? 1.46 : 1.42;
  body.prismZ([[-f, sill], [f, sill], [f, belt - 0.14], [f - 0.7, belt + 0.02], [-f + 0.1, belt + 0.04], [-f, belt - 0.1]], -hw, hw);
  trim.color(GLASS);
  const cabRear = hatch ? -f + 0.15 : suv ? -f + 0.35 : -f + 0.95;
  const cabFront = suv ? f - 1.15 : f - 1.25;
  const roofFront = suv ? f - 1.75 : f - 2.0;
  const roofRear = hatch ? -f + 0.35 : suv ? -f + 0.45 : -f + 1.3;
  trim.prismZ([[cabRear, belt], [cabFront, belt], [roofFront, roof - 0.04], [roofRear, roof - 0.02]], -hw + 0.1, hw - 0.1);
  body.prismZ([[roofRear - 0.02, roof - 0.06], [roofFront + 0.04, roof - 0.07], [roofFront, roof], [roofRear, roof]], -hw + 0.12, hw - 0.12);
  trim.color(TRIM);
  trim.box(f - 0.05, f + 0.06, sill, sill + 0.22, -hw + 0.05, hw - 0.05);
  trim.box(-f - 0.06, -f + 0.05, sill, sill + 0.22, -hw + 0.05, hw - 0.05);
  wheels(trim, [f - 0.85, -f + 0.85], hw + 0.02, suv ? 0.38 : 0.33);
  standardLights(lights, L, hw, belt - 0.2, belt - 0.16);
  return roof;
}

function buildType(type) {
  const spec = VEHICLE_SPECS[type];
  const body = new GeoBuilder({ color: false });
  const trim = new GeoBuilder({ color: true });
  const lights = new GeoBuilder({ color: true, info: true });
  const L = spec.len;
  const f = L / 2;
  const hw = spec.wid / 2;
  if (type === 'sedan' || type === 'hatch' || type === 'suv') {
    car(body, trim, lights, L, hw, type);
  } else if (type === 'police') {
    const roof = car(body, trim, lights, L, hw, 'sedan');
    trim.color(rgb('#f4f4f2'));
    trim.box(-f * 0.35, f * 0.45, 0.45, 0.8, -hw - 0.01, hw + 0.01, { top: false, bottom: false, e: false, w: false });
    lightBar(lights, -0.35, 0.35, roof, 0.62);
  } else if (type === 'van') {
    body.prismZ([[-f, 0.35], [f, 0.35], [f, 1.0], [f - 0.55, 1.25], [f - 1.1, 2.15], [-f, 2.2]], -hw, hw);
    trim.color(GLASS);
    trim.prismZ([[f - 0.6, 1.25], [f - 0.52, 1.26], [f - 1.06, 2.1], [f - 1.16, 2.1]], -hw + 0.12, hw - 0.12);
    trim.box(f - 1.9, f - 0.75, 1.28, 1.95, -hw - 0.01, hw + 0.01, { top: false });
    trim.color(TRIM);
    trim.box(f - 0.05, f + 0.06, 0.35, 0.6, -hw + 0.05, hw - 0.05);
    trim.box(-f - 0.06, -f + 0.05, 0.35, 0.6, -hw + 0.05, hw - 0.05);
    wheels(trim, [f - 0.95, -f + 1.0], hw + 0.02, 0.36);
    standardLights(lights, L, hw, 0.82, 0.9);
  } else if (type === 'ambulance') {
    // Cab plus a modular box, white with a red band and a light bar.
    body.prismZ([[f - 2.0, 0.45], [f, 0.45], [f, 1.15], [f - 0.6, 1.95], [f - 2.0, 2.0]], -hw + 0.06, hw - 0.06);
    trim.color(GLASS);
    trim.prismZ([[f - 0.62, 1.2], [f - 0.55, 1.22], [f - 1.05, 1.9], [f - 1.15, 1.9]], -hw + 0.2, hw - 0.2);
    trim.color(rgb('#f2f2f0'));
    trim.box(-f, f - 2.05, 0.55, 2.85, -hw, hw);
    trim.color(rgb('#c8102e'));
    trim.box(-f - 0.01, f - 2.04, 1.25, 1.55, -hw - 0.01, hw + 0.01, { top: false, bottom: false });
    trim.color(TRIM);
    trim.box(-f, f, 0.42, 0.6, -hw + 0.15, hw - 0.15);
    wheels(trim, [f - 1.0, -f + 1.3], hw, 0.42, 0.28);
    standardLights(lights, L, hw, 0.9, 0.95, 0.45);
    lightBar(lights, f - 1.9, f - 1.5, 2.0, hw - 0.2);
    lightBox(lights, RED, -f - 0.02, -f + 0.03, 2.55, 2.75, -hw + 0.1, -hw + 0.5, rgb('#ff2020'));
    lightBox(lights, RED, -f - 0.02, -f + 0.03, 2.55, 2.75, hw - 0.5, hw - 0.1, rgb('#ff2020'));
  } else if (type === 'engine') {
    trim.color(rgb('#b5121b'));
    body.box(-f, f, 0.55, 2.7, -hw, hw);
    trim.color(GLASS);
    trim.box(f - 1.9, f - 0.25, 1.65, 2.5, -hw - 0.01, hw + 0.01, { top: false, bottom: false });
    trim.box(f - 0.02, f + 0.02, 1.6, 2.5, -hw + 0.15, hw - 0.15, { top: false, bottom: false, n: false, s: false });
    // Ladder along the top.
    trim.color(CHROME);
    trim.box(-f + 0.4, f - 2.4, 2.75, 2.95, -0.55, -0.35);
    trim.box(-f + 0.4, f - 2.4, 2.75, 2.95, 0.35, 0.55);
    for (let x = -f + 0.8; x < f - 2.5; x += 0.7) trim.box(x - 0.05, x + 0.05, 2.78, 2.92, -0.4, 0.4);
    trim.color(rgb('#f2f2f0'));
    trim.box(-f - 0.01, f + 0.01, 1.1, 1.25, -hw - 0.01, hw + 0.01, { top: false, bottom: false });
    trim.color(TRIM);
    trim.box(-f, f, 0.42, 0.62, -hw + 0.12, hw - 0.12);
    wheels(trim, [f - 1.4, -f + 1.5, -f + 2.6], hw, 0.5, 0.32);
    standardLights(lights, L, hw, 1.0, 1.0, 0.4);
    lightBar(lights, f - 1.4, f - 0.9, 2.7, hw - 0.15);
  } else if (type === 'truck') {
    body.prismZ([[f - 2.1, 0.5], [f, 0.5], [f, 1.5], [f - 0.35, 2.75], [f - 2.1, 2.75]], -hw + 0.05, hw - 0.05);
    trim.color(GLASS);
    trim.prismZ([[f - 0.12, 1.55], [f - 0.02, 1.56], [f - 0.36, 2.6], [f - 0.48, 2.6]], -hw + 0.18, hw - 0.18);
    trim.box(f - 1.6, f - 0.8, 1.6, 2.45, -hw + 0.04, hw - 0.04, { top: false });
    trim.color(CARGO);
    trim.box(-f, f - 2.25, 0.75, 3.3, -hw, hw);
    trim.color(TRIM);
    trim.box(-f, f, 0.45, 0.75, -hw + 0.15, hw - 0.15);
    wheels(trim, [f - 1.2, -f + 1.4, -f + 2.5], hw, 0.45, 0.3);
    standardLights(lights, L, hw, 0.95, 0.8, 0.45);
  } else if (type === 'semi') {
    // Tractor up front, a long white trailer behind.
    body.prismZ([[f - 3.4, 0.6], [f, 0.6], [f, 1.8], [f - 0.6, 3.1], [f - 2.6, 3.2], [f - 3.4, 3.2]], -hw + 0.05, hw - 0.05);
    trim.color(GLASS);
    trim.prismZ([[f - 0.05, 1.85], [f + 0.02, 1.86], [f - 0.55, 2.95], [f - 0.65, 2.95]], -hw + 0.2, hw - 0.2);
    trim.color(rgb('#eceae4'));
    trim.box(-f, f - 3.6, 1.1, 4.0, -hw, hw);
    trim.color(TRIM);
    trim.box(-f, f, 0.5, 1.0, -hw + 0.2, hw - 0.2);
    wheels(trim, [f - 1.1, f - 3.0, -f + 1.0, -f + 2.2], hw, 0.5, 0.32);
    standardLights(lights, L, hw, 1.05, 1.25, 0.45);
  } else if (type === 'bus' || type === 'schoolbus') {
    const school = type === 'schoolbus';
    if (school) {
      trim.color(rgb('#f2a900'));
      body.box(-f, f - 1.3, 0.4, 2.95, -hw, hw);
      body.prismZ([[f - 1.3, 0.4], [f, 0.4], [f, 1.55], [f - 0.4, 1.75], [f - 1.3, 1.8]], -hw + 0.05, hw - 0.05);
      trim.color(rgb('#141414'));
      trim.box(-f - 0.01, f - 1.29, 1.12, 1.2, -hw - 0.012, hw + 0.012, { top: false, bottom: false, e: false, w: false });
      trim.box(-f - 0.01, f - 1.29, 0.7, 0.78, -hw - 0.012, hw + 0.012, { top: false, bottom: false, e: false, w: false });
      trim.color(GLASS);
      trim.box(-f + 0.5, f - 1.5, 1.45, 2.4, -hw - 0.012, hw + 0.012, { top: false, bottom: false, e: false, w: false });
      trim.box(f - 1.32, f - 1.26, 1.85, 2.6, -hw + 0.12, hw - 0.12, { top: false, bottom: false, n: false, s: false });
      wheels(trim, [f - 2.0, -f + 2.4], hw + 0.02, 0.48, 0.3);
      standardLights(lights, L, hw, 0.85, 0.95, 0.4);
      lightBox(lights, AMBER, f - 1.32, f - 1.24, 2.7, 2.85, -hw + 0.2, -hw + 0.45, rgb('#ffb21e'));
      lightBox(lights, AMBER, f - 1.32, f - 1.24, 2.7, 2.85, hw - 0.45, hw - 0.2, rgb('#ffb21e'));
    } else {
      body.box(-f, f, 0.35, 3.05, -hw, hw, { bottom: true });
      trim.color(GLASS);
      trim.box(-f + 0.6, f - 0.35, 1.35, 2.45, -hw - 0.012, hw + 0.012, { top: false, bottom: false, e: false, w: false });
      trim.box(f - 0.02, f + 0.015, 0.9, 2.55, -hw + 0.12, hw - 0.12, { top: false, bottom: false, n: false, s: false });
      trim.color(CHROME);
      trim.box(-f * 0.5, f * 0.3, 3.05, 3.35, -hw + 0.35, hw - 0.35);
      trim.color(TRIM);
      trim.box(f - 0.04, f + 0.05, 0.35, 0.65, -hw + 0.05, hw - 0.05);
      wheels(trim, [f - 2.3, -f + 2.8], hw + 0.02, 0.48, 0.3);
      standardLights(lights, L, hw, 0.85, 0.95, 0.4);
      lightBox(lights, SIGN, f - 0.02, f + 0.03, 2.65, 2.95, -hw + 0.3, hw - 0.3, rgb('#ffb347'));
    }
  }
  return { body: body.build(), trim: trim.build(), lights: lights.build() };
}

function lightsMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uTime = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec4 aInfo;
attribute vec3 aState;
varying float vKind;
varying vec3 vState;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vKind = aInfo.x;
vState = aState;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight;
uniform float uTime;
varying float vKind;
varying vec3 vState;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float k = 1.0;
float blink = step(0.5, fract(uTime * 1.6));
float strobe = step(0.5, fract(uTime * 3.2));
if (vKind < 0.5) k = 0.7 + uNight * 2.6;
else if (vKind < 1.5) k = 0.45 + uNight * 1.4 + vState.x * 4.0;
else if (vKind < 2.5) k = 0.9 + uNight * 2.5;
else if (vKind < 3.5) k = vState.y < -0.5 ? 0.2 + blink * 5.0 : 0.2;
else if (vKind < 4.5) k = vState.y > 0.5 ? 0.2 + blink * 5.0 : 0.2;
else if (vKind < 5.5) k = vState.z > 0.5 ? 0.15 + strobe * 9.0 : 0.25;
else if (vKind < 6.5) k = vState.z > 0.5 ? 0.15 + (1.0 - strobe) * 9.0 : 0.25;
else k = vState.z > 0.5 ? 0.2 + blink * 6.0 : 0.3;
diffuseColor.rgb *= k;`);
  };
  mat.customProgramCacheKey = () => 'asv-vehicle-lights-v1';
  return mat;
}

const POINT_VERT = /* glsl */ `
attribute vec3 aColor;
attribute float aSize;
uniform float uScale;
varying vec3 vColor;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 1.0), 2.2, 9.0);
  gl_Position = projectionMatrix * mv;
  #include <logdepthbuf_vertex>
}`;
const POINT_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform float uNight;
varying vec3 vColor;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float a = texture2D(uMap, gl_PointCoord).a;
  if (a < 0.03) discard;
  gl_FragColor = vec4(vColor * (1.1 + uNight * 0.8), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const PURPOSE_COLORS = {
  work: '#4fc3f7', home: '#81c784', school: '#ffd54f', shop: '#ba68c8', errand: '#ba68c8', visit: '#f48fb1', tourist: '#ff8a65',
  event: '#e040fb', through: '#90a4ae', emergency: '#ff1744', patrol: '#448aff', bus: '#ffd54f', freight: '#a1887f',
};

export class VehicleView {
  constructor(maxNear = 9000, maxAll = 60000) {
    this.group = new THREE.Group();
    this.group.name = 'vehicles';
    this.cap = maxNear;
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.32, metalness: 0.35 });
    const trimMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2 });
    const lightMat = lightsMaterial();
    this.types = {};
    for (const type of TYPE_NAMES) {
      const geo = buildType(type);
      const cap = ['ambulance', 'engine', 'police', 'semi', 'schoolbus', 'bus', 'truck'].includes(type) ? Math.min(2500, maxNear) : maxNear;
      const body = new THREE.InstancedMesh(geo.body, bodyMat, cap);
      const trim = new THREE.InstancedMesh(geo.trim, trimMat, cap);
      const state = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
      state.setUsage(THREE.DynamicDrawUsage);
      geo.lights.setAttribute('aState', state);
      const lights = new THREE.InstancedMesh(geo.lights, lightMat, cap);
      lights.instanceMatrix = body.instanceMatrix;
      trim.instanceMatrix = body.instanceMatrix;
      body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      body.setColorAt(0, new THREE.Color(1, 1, 1));
      body.instanceColor.setUsage(THREE.DynamicDrawUsage);
      for (const m of [body, trim, lights]) {
        m.count = 0;
        m.frustumCulled = false;
      }
      body.castShadow = true;
      trim.castShadow = true;
      this.types[type] = { body, trim, lights, state, n: 0, cap };
      this.group.add(body, trim, lights);
    }
    this.beamMat = new THREE.MeshBasicMaterial({ map: beamTexture(), color: 0xfff1d6, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const beamGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    this.beams = new THREE.InstancedMesh(beamGeo, this.beamMat, 3000);
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.beams.renderOrder = 3;
    this.group.add(this.beams);
    // Far vehicles: points.
    this.maxAll = maxAll;
    this.pPos = new Float32Array(maxAll * 3);
    this.pCol = new Float32Array(maxAll * 3);
    this.pSize = new Float32Array(maxAll);
    const pg = new THREE.BufferGeometry();
    this.pPosAttr = new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage);
    this.pColAttr = new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage);
    this.pSizeAttr = new THREE.BufferAttribute(this.pSize, 1).setUsage(THREE.DynamicDrawUsage);
    pg.setAttribute('position', this.pPosAttr);
    pg.setAttribute('aColor', this.pColAttr);
    pg.setAttribute('aSize', this.pSizeAttr);
    pg.setDrawRange(0, 0);
    this.pointsUniforms = { uMap: { value: glowTexture(64, 0.25, 1.6) }, uScale: { value: 600 }, uNight: shared.uNight };
    this.points = new THREE.Points(pg, new THREE.ShaderMaterial({
      uniforms: this.pointsUniforms, vertexShader: POINT_VERT, fragmentShader: POINT_FRAG, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.group.add(this.points);
    this.pose = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 };
    this.colorMode = 'speed';
    this._c = new THREE.Color();
    this.purposeRgb = Object.fromEntries(Object.entries(PURPOSE_COLORS).map(([k, v]) => {
      const c = new THREE.Color(v);
      return [k, [c.r, c.g, c.b]];
    }));
    this.visibleCount = 0;
  }

  setViewport(height, pixelRatio, fov) {
    this.pointsUniforms.uScale.value = (height * pixelRatio) / (2 * Math.tan((fov * Math.PI) / 360)) * 6;
  }

  /**
   * @param {object} world World (vehicles + pose)
   * @param {THREE.Camera} camera
   * @param {number} night 0..1
   * @param {number} detailRadius meters within which models are drawn
   */
  update(world, camera, night, detailRadius) {
    for (const type of TYPE_NAMES) this.types[type].n = 0;
    const beams = this.beams.instanceMatrix.array;
    let nb = 0;
    let np = 0;
    const showBeams = night > 0.05;
    const cp = camera.position;
    const r2 = detailRadius * detailRadius;
    const p = this.pose;
    const net = world.net;
    const vehicles = world.vehicles;
    const showPoints = this.showPoints !== false;
    for (let vi = 0; vi < vehicles.length; vi++) {
      const v = vehicles[vi];
      // In the driver's seat the camera sits inside the cab: the cab's own glass and panels would
      // fill the view, so the vehicle being driven is not drawn.
      if (v === this.hidden) continue;
      world.pose(v, p);
      const ddx = p.x - cp.x;
      const ddy = p.y - cp.y;
      const ddz = p.z - cp.z;
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      const type = VEHICLE_SPECS[v.type] ? v.type : 'sedan';
      const T = this.types[type];
      if (d2 < r2 && T.n < T.cap) {
        const i = T.n++;
        // Basis: forward along travel (with grade), right = forward x up, up = right x forward.
        let fx = p.dx; let fy = p.dy; let fz = p.dz;
        let rx = -fz; let rz = fx;
        const rl = Math.hypot(rx, rz) || 1;
        rx /= rl;
        rz /= rl;
        const ux = -rz * fy;
        const uy = rz * fx - rx * fz;
        const uz = rx * fy;
        const k = v.fade < 1 ? 0.25 + 0.75 * v.fade * v.fade * (3 - 2 * v.fade) : 1;
        // world.pose already includes lane offsets and pulling over for sirens.
        const px = p.x;
        const pz = p.z;
        const a = T.body.instanceMatrix.array;
        const o = i * 16;
        a[o] = fx * k; a[o + 1] = fy * k; a[o + 2] = fz * k; a[o + 3] = 0;
        a[o + 4] = ux * k; a[o + 5] = uy * k; a[o + 6] = uz * k; a[o + 7] = 0;
        a[o + 8] = rx * k; a[o + 9] = 0; a[o + 10] = rz * k; a[o + 11] = 0;
        a[o + 12] = px; a[o + 13] = p.y; a[o + 14] = pz; a[o + 15] = 1;
        if (v._paint !== v.color) {
          v._paint = v.color;
          this._c.set(v.color || '#cccccc');
          v._rgb = [this._c.r, this._c.g, this._c.b];
        }
        const col = T.body.instanceColor.array;
        col[i * 3] = v._rgb[0];
        col[i * 3 + 1] = v._rgb[1];
        col[i * 3 + 2] = v._rgb[2];
        T.state.array[i * 3] = v.brake || 0;
        T.state.array[i * 3 + 1] = v.turn || 0;
        T.state.array[i * 3 + 2] = v.siren ? 1 : 0;
        if (showBeams && k > 0.9 && nb < 3000 && d2 < 1.6e6) {
          const len = v.len > 7 ? 22 : 17;
          const wid = (v.wid || 1.9) * 3.6;
          const b = nb * 16;
          const hx = px + fx * v.len * 0.5;
          const hz = pz + fz * v.len * 0.5;
          beams[b] = fx * len; beams[b + 1] = fy * len; beams[b + 2] = fz * len; beams[b + 3] = 0;
          beams[b + 4] = 0; beams[b + 5] = 1; beams[b + 6] = 0; beams[b + 7] = 0;
          beams[b + 8] = rx * wid; beams[b + 9] = 0; beams[b + 10] = rz * wid; beams[b + 11] = 0;
          beams[b + 12] = hx; beams[b + 13] = p.y + 0.06; beams[b + 14] = hz; beams[b + 15] = 1;
          nb++;
        }
      } else if (showPoints && np < this.maxAll) {
        this.pPos[np * 3] = p.x;
        this.pPos[np * 3 + 1] = p.y + 1.5;
        this.pPos[np * 3 + 2] = p.z;
        let c;
        if (v.siren) c = (Math.floor(shared.uTime.value * 4) % 2) ? [1, 0.1, 0.1] : [0.2, 0.4, 1];
        else if (this.colorMode === 'purpose') c = this.purposeRgb[v.purpose] || this.purposeRgb.errand;
        else {
          const vf = net.vsim[v.edge] || 15;
          const r = Math.min(1, Math.max(0, v.v / vf));
          c = r > 0.75 ? [0.3, 0.95, 0.55] : r > 0.45 ? [1, 0.82, 0.25] : r > 0.2 ? [1, 0.45, 0.2] : [1, 0.15, 0.15];
        }
        this.pCol[np * 3] = c[0];
        this.pCol[np * 3 + 1] = c[1];
        this.pCol[np * 3 + 2] = c[2];
        this.pSize[np] = v.siren ? 14 : v.len > 9 ? 7 : 5;
        np++;
      }
    }
    for (const type of TYPE_NAMES) {
      const T = this.types[type];
      T.body.count = T.n;
      T.trim.count = T.n;
      T.lights.count = T.n;
      T.body.instanceMatrix.needsUpdate = true;
      T.body.instanceColor.needsUpdate = true;
      T.state.needsUpdate = true;
    }
    this.beams.count = nb;
    this.beams.instanceMatrix.needsUpdate = true;
    this.beamMat.opacity = night * 0.3;
    this.points.geometry.setDrawRange(0, np);
    this.pPosAttr.needsUpdate = true;
    this.pColAttr.needsUpdate = true;
    this.pSizeAttr.needsUpdate = true;
    this.visibleCount = vehicles.length;
  }
}

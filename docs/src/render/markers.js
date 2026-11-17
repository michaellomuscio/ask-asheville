// Map pins for places: schools, hospitals, fire stations, EMS bases, police, venues, hotels,
// breweries and parking. Pins are instanced billboards with a constant on-screen size, their
// tip on the ground so mountains hide pins behind them. The current destination gets a beacon of
// light visible across the county. Labels are HTML, placed by projection with collision culling.

import * as THREE from 'three';

const CELL = 128;
const COLS = 8;

// icon id -> [badge color, glyph]
export const ICONS = {
  ed: ['#d7263d', 'ER'],
  hospital: ['#d7263d', 'H'],
  va: ['#8a3b5a', 'VA'],
  fire: ['#e4572e', 'fire'],
  ems: ['#1e88e5', 'star'],
  police: ['#2c3e94', 'shield'],
  school_public: ['#2e8b57', 'school'],
  school_charter: ['#159a9c', 'school'],
  school_private: ['#7b52ab', 'school'],
  dest: ['#f2b705', 'dest'],
  stadium: ['#c0392b', 'ball'],
  music: ['#8e44ad', 'note'],
  arena: ['#6c3483', 'note'],
  attraction: ['#a0522d', 'landmark'],
  district: ['#d35400', 'landmark'],
  shopping: ['#16a085', 'bag'],
  parkway: ['#2d6a4f', 'mountain'],
  campus: ['#34495e', 'cap'],
  airport: ['#5d6d7e', 'plane'],
  hotel: ['#5b6fa8', 'bed'],
  brewery: ['#b9770e', 'mug'],
  parking: ['#4a6fa5', 'P'],
  college: ['#34495e', 'cap'],
  incident: ['#ff3b30', '!'],
  station_new: ['#00b894', '+'],
};
const ICON_INDEX = Object.fromEntries(Object.keys(ICONS).map((k, i) => [k, i]));

export function iconFor(p) {
  if (p.kind === 'hospital') return p.sub === 'ed' ? 'ed' : p.sub === 'va' ? 'va' : 'hospital';
  if (p.kind === 'school') return `school_${p.sub}`;
  if (p.kind === 'venue') return ICONS[p.sub] ? p.sub : 'attraction';
  return ICONS[p.kind] ? p.kind : 'attraction';
}

function drawGlyph(ctx, glyph, cx, cy, r) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = r * 0.14;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const text = (t, size = 0.9) => {
    ctx.font = `800 ${Math.round(r * size)}px "Overpass", "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, cx, cy + r * 0.06);
  };
  switch (glyph) {
    case 'fire':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.62);
      ctx.bezierCurveTo(cx + r * 0.55, cy - r * 0.1, cx + r * 0.42, cy + r * 0.55, cx, cy + r * 0.55);
      ctx.bezierCurveTo(cx - r * 0.42, cy + r * 0.55, cx - r * 0.5, cy, cx - r * 0.15, cy - r * 0.25);
      ctx.bezierCurveTo(cx - r * 0.1, cy, cx + r * 0.05, cy - r * 0.2, cx, cy - r * 0.62);
      ctx.fill();
      break;
    case 'star': {
      // Star of life: three crossed bars.
      for (let k = 0; k < 3; k++) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((k * Math.PI) / 3);
        ctx.fillRect(-r * 0.14, -r * 0.6, r * 0.28, r * 1.2);
        ctx.restore();
      }
      break;
    }
    case 'shield':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.6);
      ctx.lineTo(cx + r * 0.5, cy - r * 0.4);
      ctx.quadraticCurveTo(cx + r * 0.45, cy + r * 0.3, cx, cy + r * 0.62);
      ctx.quadraticCurveTo(cx - r * 0.45, cy + r * 0.3, cx - r * 0.5, cy - r * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    case 'school':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.6, cy - r * 0.05);
      ctx.lineTo(cx, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.6, cy - r * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - r * 0.48, cy - r * 0.05, r * 0.96, r * 0.6);
      break;
    case 'dest':
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const a = -Math.PI / 2 + (k * Math.PI) / 5;
        const rr = k % 2 ? r * 0.3 : r * 0.68;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fill();
      break;
    case 'ball':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.55);
      ctx.lineTo(cx + r * 0.55, cy);
      ctx.lineTo(cx, cy + r * 0.55);
      ctx.lineTo(cx - r * 0.55, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'note':
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.18, cy + r * 0.32, r * 0.22, r * 0.16, -0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cx - r * 0.0, cy - r * 0.55, r * 0.12, r * 0.85);
      ctx.beginPath();
      ctx.moveTo(cx + r * 0.1, cy - r * 0.55);
      ctx.quadraticCurveTo(cx + r * 0.55, cy - r * 0.35, cx + r * 0.4, cy - r * 0.05);
      ctx.stroke();
      break;
    case 'landmark':
      ctx.fillRect(cx - r * 0.5, cy + r * 0.32, r, r * 0.16);
      for (const dx of [-0.32, 0, 0.32]) ctx.fillRect(cx + dx * r - r * 0.07, cy - r * 0.18, r * 0.14, r * 0.5);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.55, cy - r * 0.18);
      ctx.lineTo(cx, cy - r * 0.6);
      ctx.lineTo(cx + r * 0.55, cy - r * 0.18);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bag':
      ctx.fillRect(cx - r * 0.42, cy - r * 0.2, r * 0.84, r * 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy - r * 0.2, r * 0.22, Math.PI, 0);
      ctx.stroke();
      break;
    case 'mountain':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.65, cy + r * 0.45);
      ctx.lineTo(cx - r * 0.15, cy - r * 0.35);
      ctx.lineTo(cx + r * 0.08, cy + r * 0.0);
      ctx.lineTo(cx + r * 0.3, cy - r * 0.5);
      ctx.lineTo(cx + r * 0.68, cy + r * 0.45);
      ctx.closePath();
      ctx.fill();
      break;
    case 'cap':
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.65, cy - r * 0.1);
      ctx.lineTo(cx, cy - r * 0.42);
      ctx.lineTo(cx + r * 0.65, cy - r * 0.1);
      ctx.lineTo(cx, cy + r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - r * 0.35, cy + r * 0.05, r * 0.7, r * 0.3);
      break;
    case 'plane':
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * 0.62);
      ctx.lineTo(cx + r * 0.1, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.62, cy + r * 0.12);
      ctx.lineTo(cx + r * 0.1, cy + r * 0.12);
      ctx.lineTo(cx + r * 0.08, cy + r * 0.45);
      ctx.lineTo(cx + r * 0.25, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.25, cy + r * 0.6);
      ctx.lineTo(cx - r * 0.08, cy + r * 0.45);
      ctx.lineTo(cx - r * 0.1, cy + r * 0.12);
      ctx.lineTo(cx - r * 0.62, cy + r * 0.12);
      ctx.lineTo(cx - r * 0.1, cy - r * 0.1);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bed':
      ctx.fillRect(cx - r * 0.6, cy + r * 0.05, r * 1.2, r * 0.25);
      ctx.fillRect(cx - r * 0.6, cy - r * 0.35, r * 0.14, r * 0.85);
      ctx.fillRect(cx - r * 0.38, cy - r * 0.18, r * 0.36, r * 0.22);
      break;
    case 'mug':
      ctx.fillRect(cx - r * 0.38, cy - r * 0.4, r * 0.56, r * 0.88);
      ctx.beginPath();
      ctx.arc(cx + r * 0.22, cy + r * 0.02, r * 0.22, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      break;
    default:
      text(glyph, glyph.length > 1 ? 0.62 : 0.9);
  }
  ctx.restore();
}

function buildAtlas() {
  const keys = Object.keys(ICONS);
  const rows = Math.ceil(keys.length / COLS);
  const c = document.createElement('canvas');
  c.width = COLS * CELL;
  c.height = rows * CELL;
  const ctx = c.getContext('2d');
  keys.forEach((k, i) => {
    const [color, glyph] = ICONS[k];
    const x = (i % COLS) * CELL;
    const y = Math.floor(i / COLS) * CELL;
    const cx = x + CELL / 2;
    const r = CELL * 0.3;
    const cy = y + CELL * 0.36;
    // Pin: circle badge with a point at the bottom center of the cell.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 5, Math.PI * 0.82, Math.PI * 2.18);
    ctx.lineTo(cx, y + CELL - 4);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    drawGlyph(ctx, glyph, cx, cy, r);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return { tex, rows, cols: COLS };
}

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute float iIcon;
attribute float iSize;
attribute float iFlag;
attribute float iFar;
uniform float uRows;
uniform float uCols;
uniform float uPixel;   // world meters per pixel at distance 1
uniform float uScale;
varying vec2 vUv;
varying float vFlag;
varying float vFade;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vec4 anchor = modelViewMatrix * vec4(iPos, 1.0);
  float dist = max(1.0, -anchor.z);
  // Minor pins shrink and fade out with distance so the county view stays readable.
  vFade = 1.0 - smoothstep(iFar * 0.7, iFar, dist);
  float s = iSize * uScale * uPixel * dist * mix(0.55, 1.0, vFade);
  if (vFade <= 0.001) s = 0.0;
  vec2 corner = position.xy; // x in [-0.5, 0.5], y in [0, 1]
  vec4 mv = anchor + vec4(corner.x * s, corner.y * s, 0.0, 0.0);
  mv.z += s * 0.25; // nudge toward the camera so pins aren't clipped by nearby rooftops
  gl_Position = projectionMatrix * mv;
  float col = mod(iIcon, uCols);
  float row = floor(iIcon / uCols);
  vUv = vec2((col + corner.x + 0.5) / uCols, 1.0 - (row + 1.0 - corner.y) / uRows);
  vFlag = iFlag;
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying float vFlag;
varying float vFade;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  vec4 c = texture2D(uAtlas, vUv);
  c.a *= vFade;
  if (c.a < 0.05) discard;
  if (vFlag > 0.5) c.rgb = mix(c.rgb, vec3(1.0, 0.85, 0.2), 0.25);
  gl_FragColor = c;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class MarkerLayer {
  constructor(pois, heightAt) {
    this.all = pois.filter((p) => p.kind !== 'place');
    this.places = pois.filter((p) => p.kind === 'place');
    this.heightAt = heightAt;
    for (const p of pois) p.y = heightAt(p.x, p.z);
    const atlas = buildAtlas();
    this.atlas = atlas;
    this.cap = this.all.length + 400;
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.iIcon = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    this.iSize = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    this.iFlag = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    this.iFar = new THREE.InstancedBufferAttribute(new Float32Array(this.cap), 1);
    quad.setAttribute('iFar', this.iFar);
    quad.setAttribute('iPos', this.iPos);
    quad.setAttribute('iIcon', this.iIcon);
    quad.setAttribute('iSize', this.iSize);
    quad.setAttribute('iFlag', this.iFlag);
    quad.instanceCount = 0;
    this.uniforms = {
      uAtlas: { value: atlas.tex },
      uRows: { value: atlas.rows },
      uCols: { value: atlas.cols },
      uPixel: { value: 0.001 },
      uScale: { value: 1 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    });
    this.mesh = new THREE.Mesh(quad, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.group = new THREE.Group();
    this.group.name = 'markers';
    this.group.add(this.mesh);
    this.visible = new Set(['school', 'hospital', 'fire', 'ems', 'police', 'venue']);
    this.extra = []; // incidents, hypothetical stations
    this.shown = [];
    this.selected = null;
    this.beacon = null;
    this.rebuild();
  }

  setCategories(set) {
    this.visible = new Set(set);
    this.rebuild();
  }

  setExtra(list) {
    this.extra = list;
    this.rebuild();
  }

  select(p) {
    this.selected = p;
    this.rebuild();
  }

  rebuild() {
    const list = [];
    for (const p of this.all) {
      const cat = p.kind === 'college' ? 'school' : p.kind;
      if (p === this.dest || this.visible.has(cat)) list.push(p);
    }
    // A destination that isn't one of the places above (a building or a spot) gets its own pin.
    if (this.dest && !this.all.includes(this.dest)) list.push(this.dest);
    for (const p of this.extra) list.push(p);
    const n = Math.min(this.cap, list.length);
    for (let i = 0; i < n; i++) {
      const p = list[i];
      if (p.y === undefined) p.y = this.heightAt(p.x, p.z);
      this.iPos.setXYZ(i, p.x, p.y + 2, p.z);
      this.iIcon.setX(i, ICON_INDEX[p === this.dest ? 'dest' : p.icon || iconFor(p)] ?? 0);
      const big = p === this.dest ? 46 : p.kind === 'hospital' && p.sub === 'ed' ? 34 : p.kind === 'venue' ? 30 : p.icon === 'incident' ? 38 : 26;
      this.iSize.setX(i, big);
      this.iFlag.setX(i, p === this.selected ? 1 : 0);
      // How far away (m) a pin stays visible.
      const far = p === this.dest || p === this.selected || p.icon === 'incident' || p.icon === 'station_new' ? 1e7
        : p.kind === 'hospital' && p.sub === 'ed' ? 45000 : p.kind === 'venue' ? 15000 : p.kind === 'school' && p.sub === 'private' ? 10000
          : p.kind === 'hotel' || p.kind === 'brewery' || p.kind === 'parking' ? 4500 : 7000;
      this.iFar.setX(i, far);
    }
    for (const a of [this.iPos, this.iIcon, this.iSize, this.iFlag, this.iFar]) a.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
    this.shown = list.slice(0, n);
  }

  update(camera, viewportHeight) {
    const fovRad = (camera.fov * Math.PI) / 180;
    this.uniforms.uPixel.value = (2 * Math.tan(fovRad / 2)) / viewportHeight;
  }

  /** Marker under a screen point (client coords), or null. */
  pick(clientX, clientY, camera, rect) {
    const v = new THREE.Vector3();
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < this.shown.length; i++) {
      const p = this.shown[i];
      v.set(p.x, p.y + 2, p.z).project(camera);
      if (v.z > 1 || v.z < -1) continue;
      const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
      const size = this.iSize.getX(i) * this.uniforms.uScale.value;
      // The pin's badge sits above its tip.
      const dx = clientX - sx;
      const dy = clientY - (sy - size * 0.64);
      const d = Math.hypot(dx, dy);
      if (d < size * 0.42 && d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** Mark the destination: a large pin and a tall column of light. */
  setDestination(p) {
    this.dest = p;
    if (!this.beacon) this.createBeacon(p);
    else this.beacon.position.set(p.x, this.heightAt(p.x, p.z), p.z);
    this.rebuild();
  }

  createBeacon(p) {
    const h = 900;
    const geo = new THREE.CylinderGeometry(9, 9, h, 24, 1, true).translate(0, h / 2, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#ffc93c') } },
      vertexShader: /* glsl */ `
varying float vH;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  vH = position.y / ${h.toFixed(1)};
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  #include <logdepthbuf_vertex>
}`,
      fragmentShader: /* glsl */ `
uniform float uTime;
uniform vec3 uColor;
varying float vH;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float a = (1.0 - vH) * (1.0 - vH) * (0.55 + 0.25 * sin(uTime * 2.0 - vH * 12.0));
  gl_FragColor = vec4(uColor * 1.6, a * 0.65);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p.x, this.heightAt(p.x, p.z), p.z);
    m.renderOrder = 9;
    this.beacon = m;
    this.group.add(m);
    return m;
  }

  tick(t) {
    if (this.beacon) this.beacon.material.uniforms.uTime.value = t;
  }
}

/** HTML labels for a few important places, projected each frame with simple collision culling. */
export class LabelLayer {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);
    this.items = [];
    this.v = new THREE.Vector3();
  }

  set(items) {
    this.root.innerHTML = '';
    this.items = items.map((it) => {
      const el = document.createElement('div');
      el.className = `label label-${it.style || 'place'}`;
      el.textContent = it.text;
      this.root.appendChild(el);
      return { ...it, el, w: 0 };
    });
  }

  update(camera, rect, camHeight) {
    const placed = [];
    const v = this.v;
    // Higher-priority labels claim space first.
    const order = [...this.items].sort((a, b) => b.priority - a.priority);
    for (const it of order) {
      const minH = it.minHeight ?? 0;
      const maxH = it.maxHeight ?? Infinity;
      let show = camHeight >= minH && camHeight <= maxH;
      if (show) {
        v.set(it.x, it.y + (it.lift || 0), it.z).project(camera);
        show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      }
      if (show) {
        const sx = (v.x * 0.5 + 0.5) * rect.width;
        const sy = (-v.y * 0.5 + 0.5) * rect.height;
        if (!it.w) it.w = it.el.offsetWidth || it.text.length * 7;
        const box = [sx - it.w / 2 - 4, sy - 12, sx + it.w / 2 + 4, sy + 10];
        for (const b of placed) {
          if (box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1]) {
            show = false;
            break;
          }
        }
        if (show) {
          placed.push(box);
          it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%)`;
        }
      }
      it.el.style.display = show ? '' : 'none';
    }
  }
}

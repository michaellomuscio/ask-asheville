// Highlighted paths: routes along the road network (to the destination, emergency runs)
// and outlines draped on the terrain (ORS isochrones, the county line). Ribbons keep a minimum
// on-screen width and carry an animated flow so direction reads at a glance.

import * as THREE from 'three';
import { shared } from './materials.js';

const VERT = /* glsl */ `
attribute vec2 aSide;
attribute vec2 aLine; // u meters along, v -1..1 across
uniform vec3 uCamPos;
uniform float uPixelAngle;
uniform float uWidth;
uniform float uMinPx;
varying vec2 vLine;
varying float vW;
#include <common>
#include <logdepthbuf_pars_vertex>
void main() {
  float d = distance(position, uCamPos);
  float w = max(uWidth * 0.5, d * uPixelAngle * uMinPx * 0.5);
  vec3 p = position;
  p.xz += aSide * aLine.y * w;
  p.y += 0.9 + d * 0.0012;
  vLine = aLine;
  vW = w;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  #include <logdepthbuf_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uFlow;
uniform float uOpacity;
varying vec2 vLine;
varying float vW;
#include <logdepthbuf_pars_fragment>
void main() {
  #include <logdepthbuf_fragment>
  float edge = 1.0 - smoothstep(0.7, 1.0, abs(vLine.y));
  float core = 1.0 - smoothstep(0.0, 0.55, abs(vLine.y));
  // Chevrons moving along the route.
  float period = max(vW * 6.0, 8.0);
  float ph = fract((vLine.x - uTime * uFlow * period * 0.6) / period - abs(vLine.y) * 0.25);
  float chev = smoothstep(0.0, 0.08, ph) * (1.0 - smoothstep(0.3, 0.42, ph));
  vec3 c = mix(uColor, vec3(1.0), (core * 0.25 + chev * 0.35 * step(0.5, uFlow)));
  gl_FragColor = vec4(c * 1.25, edge * uOpacity);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function ribbon(points, closed = false) {
  // points: flat [x, y, z, ...]
  const n = points.length / 3;
  const pos = [];
  const side = [];
  const line = [];
  const idx = [];
  let u = 0;
  for (let i = 0; i < n; i++) {
    const ip = i > 0 ? i - 1 : closed ? n - 2 : i;
    const inx = i < n - 1 ? i + 1 : closed ? 1 : i;
    let tx = points[inx * 3] - points[ip * 3];
    let tz = points[inx * 3 + 2] - points[ip * 3 + 2];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    if (i > 0) u += Math.hypot(points[i * 3] - points[(i - 1) * 3], points[i * 3 + 2] - points[(i - 1) * 3 + 2]);
    for (const v of [-1, 1]) {
      pos.push(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]);
      side.push(-tz, tx);
      line.push(u, v);
    }
    if (i < n - 1) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 2));
  g.setAttribute('aLine', new THREE.Float32BufferAttribute(line, 2));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export class RouteLayer {
  constructor(net, heightAt) {
    this.net = net;
    this.heightAt = heightAt;
    this.group = new THREE.Group();
    this.group.name = 'routes';
    this.items = new Map();
  }

  material(color, { width = 7, minPx = 4, flow = 1, opacity = 0.95 } = {}) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uTime: shared.uTime,
        uFlow: { value: flow },
        uOpacity: { value: opacity },
        uWidth: { value: width },
        uMinPx: { value: minPx },
        uCamPos: shared.uCamPos,
        uPixelAngle: shared.uPixelAngle,
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
    });
  }

  /** Polyline points along a list of directed edges. */
  pointsOfEdges(edges) {
    const net = this.net;
    const out = [];
    for (const e of edges) {
      const g = net.geom[e];
      const o0 = net.geomOff[g];
      const o1 = net.geomOff[g + 1];
      if (net.dir[e] > 0) for (let i = o0; i < o1; i++) out.push(net.gx[i], net.gy[i], net.gz[i]);
      else for (let i = o1 - 1; i >= o0; i--) out.push(net.gx[i], net.gy[i], net.gz[i]);
    }
    return out;
  }

  setRoute(id, edges, color, opts) {
    this.remove(id);
    if (!edges || !edges.length) return;
    const g = ribbon(this.pointsOfEdges(edges));
    const m = new THREE.Mesh(g, this.material(color, opts));
    m.renderOrder = 8;
    m.frustumCulled = false;
    this.group.add(m);
    this.items.set(id, m);
  }

  /** Draped outline from [[x, z], ...] rings (densified so it hugs the terrain). */
  setOutline(id, rings, color, opts = {}) {
    this.remove(id);
    const group = new THREE.Group();
    const mat = this.material(color, { width: opts.width ?? 14, minPx: opts.minPx ?? 2.2, flow: 0, opacity: opts.opacity ?? 0.85 });
    for (const ring of rings) {
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const [x0, z0] = ring[i];
        const [x1, z1] = ring[(i + 1) % ring.length];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 40));
        for (let k = 0; k < n; k++) {
          const x = x0 + ((x1 - x0) * k) / n;
          const z = z0 + ((z1 - z0) * k) / n;
          pts.push(x, this.heightAt(x, z) + 1.5, z);
        }
      }
      if (pts.length >= 6) {
        pts.push(pts[0], pts[1], pts[2]);
        const m = new THREE.Mesh(ribbon(pts, true), mat);
        m.renderOrder = 7;
        m.frustumCulled = false;
        group.add(m);
      }
    }
    this.group.add(group);
    this.items.set(id, group);
  }

  remove(id) {
    const m = this.items.get(id);
    if (!m) return;
    this.group.remove(m);
    m.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    this.items.delete(id);
  }

  clear(prefix = '') {
    for (const id of [...this.items.keys()]) if (id.startsWith(prefix)) this.remove(id);
  }
}

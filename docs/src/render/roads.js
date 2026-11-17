// Road surfaces: one ribbon per polyline, as wide as its lanes, laid on the terrain heights the
// network carries (bridges span straight, tunnels are hidden). Pads fill the gaps where roads
// meet. Ribbons are batched into 4 km tiles for culling. A per-geometry data texture colors
// each direction by congestion, and a node-time texture colors the network by drive time.

import * as THREE from 'three';
import { createRoadMaterial } from './materials.js';
import { CLASS, FLAG, LANE_W } from '../sim/graph.js';

const TILE = 4000;

function halfWidth(net, g) {
  const e = net.geomEdge[g];
  const cls = net.cls[e];
  const lf = net.geomLanesFwd[g];
  const lb = net.geomLanesBwd[g];
  if (cls === CLASS.SERVICE || cls === CLASS.LIVING_STREET) return 2.4;
  if (cls === CLASS.RESIDENTIAL) return 3.4;
  const oneway = lf === 0 || lb === 0;
  const lanes = lf + lb;
  if (oneway) {
    const shoulder = cls <= CLASS.TRUNK_LINK ? 2.6 : 0.8;
    return (lanes * 3.6 + shoulder) / 2;
  }
  return (lanes * LANE_W + 1.2) / 2;
}

export class RoadView {
  /** @param {import('../sim/graph.js').RoadNetwork} net */
  constructor(net) {
    this.net = net;
    this.group = new THREE.Group();
    this.group.name = 'roads';
    // Congestion per geometry (R forward, G backward), and drive time per node.
    this.geomW = 1024;
    const gh = Math.ceil(net.geomCount / this.geomW);
    this.geomData = new Uint8Array(this.geomW * gh * 4);
    this.geomTex = new THREE.DataTexture(this.geomData, this.geomW, gh, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.geomTex.needsUpdate = true;
    this.nodeW = 256;
    const nh = Math.ceil(net.nodeCount / this.nodeW);
    this.nodeTime = new Float32Array(this.nodeW * nh).fill(1e30);
    this.nodeTimeTex = new THREE.DataTexture(this.nodeTime, this.nodeW, nh, THREE.RedFormat, THREE.FloatType);
    this.nodeTimeTex.needsUpdate = true;
    this.material = createRoadMaterial({ geomTex: this.geomTex, geomW: this.geomW, nodeTimeTex: this.nodeTimeTex, nodeW: this.nodeW });
    this.build();
  }

  build() {
    const net = this.net;
    const tiles = new Map();
    const tileOf = (x, z) => {
      const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      let t = tiles.get(key);
      if (!t) {
        t = { pos: [], side: [], road: [], ends: [], idx: [], n: 0 };
        tiles.set(key, t);
      }
      return t;
    };
    const endNodes = (g) => {
      const e = net.geomEdge[g];
      return net.dir[e] > 0 ? [net.from[e], net.to[e]] : [net.to[e], net.from[e]];
    };
    for (let g = 0; g < net.geomCount; g++) {
      const e = net.geomEdge[g];
      if (e < 0) continue;
      if (net.flags[e] & FLAG.TUNNEL) continue;
      const o0 = net.geomOff[g];
      const o1 = net.geomOff[g + 1];
      const n = o1 - o0;
      if (n < 2) continue;
      const mid = o0 + (n >> 1);
      const t = tileOf(net.gx[mid], net.gz[mid]);
      const hw = halfWidth(net, g);
      const cls = net.cls[e];
      const lf = Math.min(7, net.geomLanesFwd[g]);
      const lb = Math.min(7, net.geomLanesBwd[g]);
      const bridge = net.flags[e] & FLAG.BRIDGE ? 1 : 0;
      const info = cls + lf * 16 + lb * 128 + bridge * 1024;
      const lift = (16 - cls) * 0.03;
      const [na, nb] = endNodes(g);
      const total = net.geomLen[g] || 1;
      const base = t.n;
      for (let i = o0; i < o1; i++) {
        // Lateral direction from the neighboring segments (mitered at joints).
        const ip = i > o0 ? i - 1 : i;
        const inx = i < o1 - 1 ? i + 1 : i;
        let ax = net.gx[i] - net.gx[ip];
        let az = net.gz[i] - net.gz[ip];
        let bx = net.gx[inx] - net.gx[i];
        let bz = net.gz[inx] - net.gz[i];
        let la = Math.hypot(ax, az);
        let lb2 = Math.hypot(bx, bz);
        if (la < 1e-6) { ax = bx; az = bz; la = lb2; }
        if (lb2 < 1e-6) { bx = ax; bz = az; lb2 = la; }
        ax /= la || 1; az /= la || 1; bx /= lb2 || 1; bz /= lb2 || 1;
        let tx = ax + bx;
        let tz = az + bz;
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl;
        tz /= tl;
        // Right-hand normal of the travel direction (x east, z south): (-tz, tx).
        let sx = -tz;
        let sz = tx;
        const cosHalf = Math.max(0.5, sx * -az + sz * ax);
        sx /= cosHalf;
        sz /= cosHalf;
        const u = net.geomCum[i];
        const y = net.gy[i] + lift;
        for (const v of [-1, 1]) {
          t.pos.push(net.gx[i], y, net.gz[i]);
          t.side.push(sx, sz);
          t.road.push(u, v, hw, info);
          t.ends.push(na, nb, u / total, g);
        }
        t.n += 2;
      }
      for (let k = 0; k < n - 1; k++) {
        const a = base + k * 2;
        // (left, right) pairs: winding so the face points up.
        t.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    // Junction pads: discs at nodes where three or more polylines meet.
    const deg = new Uint8Array(net.nodeCount);
    const padR = new Float32Array(net.nodeCount);
    for (let g = 0; g < net.geomCount; g++) {
      const e = net.geomEdge[g];
      if (e < 0 || net.flags[e] & FLAG.TUNNEL) continue;
      const hw = halfWidth(net, g);
      for (const nd of endNodes(g)) {
        deg[nd]++;
        if (hw > padR[nd]) padR[nd] = hw;
      }
    }
    for (let i = 0; i < net.nodeCount; i++) {
      if (deg[i] < 2) continue;
      const t = tileOf(net.nodeX[i], net.nodeZ[i]);
      const r = padR[i] * 1.05;
      const seg = r > 6 ? 14 : 10;
      const c = t.n;
      const y = net.nodeY[i] + 0.02;
      t.pos.push(net.nodeX[i], y, net.nodeZ[i]);
      t.side.push(0, 0);
      t.road.push(0, 0, r, CLASS.SERVICE);
      t.ends.push(i, i, 0, net.geom[net.outEdges[net.outStart[i]]] || 0);
      t.n++;
      for (let k = 0; k <= seg; k++) {
        const a = (k / seg) * Math.PI * 2;
        t.pos.push(net.nodeX[i], y, net.nodeZ[i]);
        t.side.push(Math.cos(a), Math.sin(a));
        t.road.push(0, 1, r, CLASS.SERVICE);
        t.ends.push(i, i, 0, net.geom[net.outEdges[net.outStart[i]]] || 0);
        t.n++;
        if (k > 0) t.idx.push(c, c + k + 1, c + k);
      }
    }
    for (const t of tiles.values()) {
      if (!t.n) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
      g.setAttribute('aSide', new THREE.Float32BufferAttribute(t.side, 2));
      g.setAttribute('aRoad', new THREE.Float32BufferAttribute(t.road, 4));
      g.setAttribute('aEnds', new THREE.Float32BufferAttribute(t.ends, 4));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(t.n * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(t.n > 65535 ? new THREE.Uint32BufferAttribute(t.idx, 1) : new THREE.Uint16BufferAttribute(t.idx, 1));
      g.computeBoundingSphere();
      g.boundingSphere.radius += 40;
      const mesh = new THREE.Mesh(g, this.material);
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
    }
  }

  /** Copy live congestion ratios (per directed edge) into the geometry texture. */
  setCongestion(ratio) {
    const net = this.net;
    const d = this.geomData;
    d.fill(0);
    for (let e = 0; e < net.edgeCount; e++) {
      const r = ratio[e];
      if (!(r > 1.01)) continue;
      const g = net.geom[e];
      const v = Math.min(255, Math.round(((r - 1) / 4) * 255));
      d[g * 4 + (net.dir[e] > 0 ? 0 : 1)] = v;
    }
    this.geomTex.needsUpdate = true;
  }

  /** Drive times (s) per node for the time-colored network; pass null to clear. */
  setNodeTimes(times, maxSeconds = 3600, bandSeconds = 300) {
    if (times) {
      for (let i = 0; i < this.net.nodeCount; i++) this.nodeTime[i] = times[i] < Infinity ? times[i] : 1e30;
    } else {
      this.nodeTime.fill(1e30);
    }
    this.nodeTimeTex.needsUpdate = true;
    this.material.userData.uniforms.uTimeMax.value = maxSeconds;
    this.material.userData.uniforms.uBand.value = bandSeconds;
  }

  setMode(mode) {
    this.material.userData.uniforms.uMode.value = mode === 'congestion' ? 1 : mode === 'time' ? 2 : 0;
  }
}

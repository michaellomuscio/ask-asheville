// Routing worker: answers batches of trip routes off the main thread with the same landmark
// A* the simulation uses. The main thread sends the road graph and landmarks once, then fresh
// live travel-time weights every few simulated seconds.

import { Router } from '../sim/router.js';

let router = null;
let weights = null;

self.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'init') {
    const net = {
      nodeCount: m.nodeCount,
      outStart: m.outStart,
      outEdges: m.outEdges,
      inStart: m.inStart,
      inEdges: m.inEdges,
      from: m.from,
      to: m.to,
      len: m.len,
      nodeX: m.nodeX,
      nodeZ: m.nodeZ,
      maxSpeed: m.maxSpeed,
    };
    router = new Router(net);
    router.landmarks = { count: m.lmCount, nodes: [], lmFrom: m.lmFrom, lmTo: m.lmTo, n: m.nodeCount };
    weights = m.weights;
    self.postMessage({ type: 'ready' });
    return;
  }
  if (m.type === 'weights') {
    weights = m.weights;
    return;
  }
  if (m.type === 'route' && router) {
    const { ids, o, d } = m;
    const n = ids.length;
    const offsets = new Int32Array(n + 1);
    const times = new Float32Array(n);
    const parts = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const r = router.routeALT(o[i], d[i], weights);
      if (r && r.edges.length) {
        parts.push(r.edges);
        total += r.edges.length;
        times[i] = r.time;
      } else {
        parts.push(null);
        times[i] = -1;
      }
      offsets[i + 1] = total;
    }
    const edges = new Int32Array(total);
    let k = 0;
    for (const p of parts) {
      if (!p) continue;
      edges.set(p, k);
      k += p.length;
    }
    self.postMessage({ type: 'routes', ids, offsets, edges, times }, [ids.buffer, offsets.buffer, edges.buffer, times.buffer]);
  }
};

// Shortest-time routing on the road network: Dijkstra (one or many sources, forward or
// reverse) and A* point to point. Weights are seconds per edge, so the same code answers
// free-flow, typical rush hour and live questions.

export class MinHeap {
  constructor(capacity = 1024) {
    this.keys = new Float64Array(capacity);
    this.vals = new Int32Array(capacity);
    this.size = 0;
  }

  grow() {
    const k = new Float64Array(this.keys.length * 2);
    k.set(this.keys);
    const v = new Int32Array(this.vals.length * 2);
    v.set(this.vals);
    this.keys = k;
    this.vals = v;
  }

  push(key, val) {
    if (this.size === this.keys.length) this.grow();
    let i = this.size++;
    const keys = this.keys;
    const vals = this.vals;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Removes the minimum; read it from this.topKey/this.topVal. */
  pop() {
    const keys = this.keys;
    const vals = this.vals;
    this.topKey = keys[0];
    this.topVal = vals[0];
    const n = --this.size;
    if (n === 0) return;
    const k = keys[n];
    const v = vals[n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= n) break;
      if (c + 1 < n && keys[c + 1] < keys[c]) c++;
      if (keys[c] >= k) break;
      keys[i] = keys[c];
      vals[i] = vals[c];
      i = c;
    }
    keys[i] = k;
    vals[i] = v;
  }

  clear() {
    this.size = 0;
  }
}

export class Router {
  /** @param {import('./graph.js').RoadNetwork} net */
  constructor(net) {
    this.net = net;
    this.heap = new MinHeap(1 << 16);
    const n = net.nodeCount;
    this.gScore = new Float64Array(n);
    this.seen = new Int32Array(n); // generation stamps, so arrays needn't be cleared per query
    this.closed = new Int32Array(n);
    this.predEdge = new Int32Array(n);
    this.stamp = 0;
  }

  /**
   * Single- or multi-source Dijkstra.
   * @param {Array<number|{node:number,t0?:number,label?:number}>} sources
   * @param {Float32Array|Float64Array} weights seconds per edge (Infinity = closed)
   * @param {object} [o]
   * @param {boolean} [o.reverse] times TO the sources (follows edges backward)
   * @param {number} [o.maxTime] stop expanding beyond this many seconds
   * @param {Float32Array} [o.out] reuse a time array (Infinity where unreached)
   * @param {Int32Array} [o.pred] receives the edge used to reach each node (-1 = source/unreached)
   * @param {Int32Array} [o.label] receives the label (or index) of the source that reached each node
   */
  dijkstra(sources, weights, o = {}) {
    const net = this.net;
    const n = net.nodeCount;
    const dist = o.out || new Float32Array(n);
    dist.fill(Infinity);
    const pred = o.pred || null;
    if (pred) pred.fill(-1);
    const label = o.label || null;
    if (label) label.fill(-1);
    const maxTime = o.maxTime ?? Infinity;
    const reverse = !!o.reverse;
    const start = reverse ? net.inStart : net.outStart;
    const adj = reverse ? net.inEdges : net.outEdges;
    const other = reverse ? net.from : net.to;
    const heap = this.heap;
    heap.clear();
    sources.forEach((s, k) => {
      const node = typeof s === 'number' ? s : s.node;
      const t0 = typeof s === 'number' ? 0 : s.t0 || 0;
      if (node < 0 || node >= n) return;
      if (t0 < dist[node]) {
        dist[node] = Math.fround(t0);
        if (label) label[node] = typeof s === 'number' ? k : (s.label ?? k);
        heap.push(Math.fround(t0), node);
      }
    });
    while (heap.size) {
      heap.pop();
      const u = heap.topVal;
      const du = heap.topKey;
      if (du > dist[u]) continue;
      if (du > maxTime) break;
      for (let k = start[u]; k < start[u + 1]; k++) {
        const e = adj[k];
        const w = weights[e];
        if (!(w < Infinity)) continue;
        const v = other[e];
        // Round like the Float32 time array, or the heap key would never equal dist[v].
        const nd = Math.fround(du + w);
        if (nd < dist[v]) {
          dist[v] = nd;
          if (pred) pred[v] = e;
          if (label) label[v] = label[u];
          heap.push(nd, v);
        }
      }
    }
    return dist;
  }

  /** A* shortest-time path. Returns {edges: Int32Array, time, length} or null. */
  route(fromNode, toNode, weights, { maxSpeed = this.net.maxSpeed * 1.05 } = {}) {
    const net = this.net;
    if (fromNode === toNode) return { edges: new Int32Array(0), time: 0, length: 0 };
    const stamp = ++this.stamp;
    if (stamp > 2e9) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    const g = this.gScore;
    const seen = this.seen;
    const closed = this.closed;
    const pred = this.predEdge;
    const heap = this.heap;
    heap.clear();
    const tx = net.nodeX[toNode];
    const tz = net.nodeZ[toNode];
    const inv = 1 / maxSpeed;
    const h = (i) => Math.hypot(net.nodeX[i] - tx, net.nodeZ[i] - tz) * inv;
    g[fromNode] = 0;
    seen[fromNode] = stamp;
    pred[fromNode] = -1;
    heap.push(h(fromNode), fromNode);
    const start = net.outStart;
    const adj = net.outEdges;
    const to = net.to;
    let found = false;
    while (heap.size) {
      heap.pop();
      const u = heap.topVal;
      if (closed[u] === stamp) continue;
      closed[u] = stamp;
      if (u === toNode) {
        found = true;
        break;
      }
      const gu = g[u];
      for (let k = start[u]; k < start[u + 1]; k++) {
        const e = adj[k];
        const w = weights[e];
        if (!(w < Infinity)) continue;
        const v = to[e];
        if (closed[v] === stamp) continue;
        const nd = gu + w;
        if (seen[v] !== stamp || nd < g[v]) {
          seen[v] = stamp;
          g[v] = nd;
          pred[v] = e;
          heap.push(nd + h(v), v);
        }
      }
    }
    if (!found) return null;
    const path = [];
    let cur = toNode;
    let length = 0;
    while (cur !== fromNode) {
      const e = pred[cur];
      path.push(e);
      length += net.len[e];
      cur = net.from[e];
    }
    path.reverse();
    return { edges: Int32Array.from(path), time: g[toNode], length };
  }

  /**
   * Precompute landmark distances for ALT (A* with landmarks and the triangle inequality).
   * Landmarks are spread by farthest-point selection on `weights` (free flow by default). Any
   * weights at least as large (live, typical rush hour) keep the heuristic admissible.
   */
  prepareLandmarks(count = 12, weights = this.net.ffTime) {
    const net = this.net;
    const n = net.nodeCount;
    const lmFrom = new Float32Array(count * n); // d(L -> v)
    const lmTo = new Float32Array(count * n); // d(v -> L)
    const dmin = new Float32Array(n).fill(Infinity);
    const tmp = new Float32Array(n);
    // Start from the node farthest from the network's middle.
    this.dijkstra([net.nearestNode((net.bounds.x0 + net.bounds.x1) / 2, (net.bounds.z0 + net.bounds.z1) / 2)], weights, { out: tmp });
    let next = 0;
    for (let i = 1; i < n; i++) if (tmp[i] < Infinity && tmp[i] > tmp[next]) next = i;
    const nodes = [];
    for (let k = 0; k < count; k++) {
      nodes.push(next);
      const fwd = lmFrom.subarray(k * n, (k + 1) * n);
      const rev = lmTo.subarray(k * n, (k + 1) * n);
      this.dijkstra([next], weights, { out: tmp });
      fwd.set(tmp);
      this.dijkstra([next], weights, { out: tmp, reverse: true });
      rev.set(tmp);
      let best = -1;
      let bestD = -1;
      for (let i = 0; i < n; i++) {
        const d = Math.min(fwd[i], rev[i]);
        if (d < dmin[i]) dmin[i] = d;
        if (dmin[i] < Infinity && dmin[i] > bestD) {
          bestD = dmin[i];
          best = i;
        }
      }
      next = best;
    }
    this.landmarks = { count, nodes, lmFrom, lmTo, n };
    return this.landmarks;
  }

  /**
   * A* with landmark lower bounds (falls back to plain A* when no landmarks are prepared).
   * `weights` must be >= the weights the landmarks were prepared with.
   */
  routeALT(fromNode, toNode, weights) {
    const lm = this.landmarks;
    if (!lm) return this.route(fromNode, toNode, weights);
    const net = this.net;
    if (fromNode === toNode) return { edges: new Int32Array(0), time: 0, length: 0 };
    const stamp = ++this.stamp;
    if (stamp > 2e9) {
      this.seen.fill(0);
      this.closed.fill(0);
      this.stamp = 1;
    }
    const { count, lmFrom, lmTo, n } = lm;
    // Distances to and from the target, per landmark.
    const tFrom = new Float32Array(count);
    const tTo = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      tFrom[k] = lmFrom[k * n + toNode];
      tTo[k] = lmTo[k * n + toNode];
    }
    const h = (v) => {
      let best = 0;
      for (let k = 0, o = v; k < count; k++, o += n) {
        const a = tFrom[k] - lmFrom[o];
        const b = lmTo[o] - tTo[k];
        if (a > best) best = a;
        if (b > best) best = b;
      }
      return best;
    };
    const g = this.gScore;
    const seen = this.seen;
    const closed = this.closed;
    const pred = this.predEdge;
    const heap = this.heap;
    heap.clear();
    g[fromNode] = 0;
    seen[fromNode] = stamp;
    pred[fromNode] = -1;
    heap.push(h(fromNode), fromNode);
    const start = net.outStart;
    const adj = net.outEdges;
    const to = net.to;
    let found = false;
    while (heap.size) {
      heap.pop();
      const u = heap.topVal;
      if (closed[u] === stamp) continue;
      closed[u] = stamp;
      if (u === toNode) {
        found = true;
        break;
      }
      const gu = g[u];
      for (let k = start[u]; k < start[u + 1]; k++) {
        const e = adj[k];
        const w = weights[e];
        if (!(w < Infinity)) continue;
        const v = to[e];
        if (closed[v] === stamp) continue;
        const nd = gu + w;
        if (seen[v] !== stamp || nd < g[v]) {
          seen[v] = stamp;
          g[v] = nd;
          pred[v] = e;
          heap.push(nd + h(v), v);
        }
      }
    }
    if (!found) return null;
    const path = [];
    let cur = toNode;
    let length = 0;
    while (cur !== fromNode) {
      const e = pred[cur];
      path.push(e);
      length += net.len[e];
      cur = net.from[e];
    }
    path.reverse();
    return { edges: Int32Array.from(path), time: g[toNode], length };
  }

  /** Edges from a Dijkstra predecessor tree. Forward trees: source -> node. Reverse: node -> source. */
  pathFromTree(pred, node, reverse = false) {
    const net = this.net;
    const path = [];
    let cur = node;
    let guard = 0;
    while (pred[cur] >= 0 && guard++ < 1e6) {
      const e = pred[cur];
      path.push(e);
      cur = reverse ? net.to[e] : net.from[e];
    }
    if (!reverse) path.reverse();
    return Int32Array.from(path);
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { data, picker } from './helpers.js';
import { Router } from '../docs/src/sim/router.js';

test('every core road node can reach and be reached from downtown', async () => {
  const d = await data();
  const net = d.roads;
  const r = new Router(net);
  const to = r.dijkstra([d.focus.node], net.ffTime, { reverse: true });
  const from = r.dijkstra([d.focus.node], net.ffTime);
  const core = net.strongCore();
  let unreachable = 0;
  let edgeOnly = 0;
  for (let i = 0; i < net.nodeCount; i++) {
    const ok = to[i] < Infinity && from[i] < Infinity;
    if (core[i] && !ok) unreachable++;
    // Outside the core: one-way stubs at the county line, reachable one way only.
    if (!core[i] && !(to[i] < Infinity) && !(from[i] < Infinity)) edgeOnly++;
  }
  assert.equal(unreachable, 0);
  // A few roads dip into the 2.5 km buffer and leave again without touching the county network.
  assert.ok(edgeOnly < net.nodeCount * 0.025, `${edgeOnly} isolated boundary nodes`);
});

test('every populated building has a drive time to downtown', async () => {
  const d = await data();
  const r = new Router(d.roads);
  const to = r.dijkstra([d.focus.node], d.roads.ffTime, { reverse: true });
  const b = d.buildings;
  let missing = 0;
  for (let i = 0; i < b.count; i++) if (b.residents[i] > 0 && !(to[b.node[i]] < Infinity)) missing++;
  assert.equal(missing, 0);
  // The airport to downtown is a 15-20 minute drive in free flow (about 15 miles, mostly I-26).
  const avl = d.pois.find((p) => p.id === 'avl');
  assert.ok(to[avl.node] > 12 * 60 && to[avl.node] < 24 * 60, `airport -> downtown ${to[avl.node]} s`);
});

test('A*, landmark A* and Dijkstra agree', async () => {
  const d = await data();
  const net = d.roads;
  const r = new Router(net);
  r.prepareLandmarks(8);
  const pick = picker(7);
  const core = net.strongCore();
  const nodes = [];
  for (let i = 0; i < net.nodeCount; i++) if (core[i]) nodes.push(i);
  assert.ok(nodes.length > net.nodeCount * 0.97, 'nearly every node is in the strongly connected core');
  for (let k = 0; k < 40; k++) {
    const a = nodes[pick(nodes.length)];
    const b = nodes[pick(nodes.length)];
    const dist = r.dijkstra([a], net.ffTime);
    const x = r.route(a, b, net.ffTime);
    const y = r.routeALT(a, b, net.ffTime);
    assert.ok(Math.abs(x.time - dist[b]) < 0.05, `A* ${x.time} vs Dijkstra ${dist[b]}`);
    assert.ok(Math.abs(y.time - dist[b]) < 0.05, `ALT ${y.time} vs Dijkstra ${dist[b]}`);
    // The path is continuous and its edge times add up.
    let t = 0;
    for (let i = 0; i < y.edges.length; i++) {
      if (i) assert.equal(net.from[y.edges[i]], net.to[y.edges[i - 1]]);
      t += net.ffTime[y.edges[i]];
    }
    assert.ok(Math.abs(t - y.time) < 0.05);
  }
});

test('points along an edge are continuous and lanes sit right of travel', async () => {
  const d = await data();
  const net = d.roads;
  const p = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
  const pick = picker(3);
  for (let k = 0; k < 200; k++) {
    const e = pick(net.edgeCount);
    let prev = null;
    for (let s = 0; s <= net.len[e]; s += Math.max(1, net.len[e] / 10)) {
      net.pointAt(e, s, p);
      if (prev) assert.ok(Math.hypot(p.x - prev.x, p.z - prev.z) < net.len[e] / 10 + 2);
      prev = { x: p.x, z: p.z };
    }
    // Lane 0 of a two-way road is offset to the right (positive), never onto the other side.
    if (net.twin[e] >= 0) assert.ok(net.laneOffset(e, 0) > 0);
  }
});

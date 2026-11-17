import test from 'node:test';
import assert from 'node:assert/strict';
import { data, world } from './helpers.js';
import { Signals } from '../docs/src/sim/signals.js';
import { Traffic, VEHICLE_TYPES } from '../docs/src/sim/traffic.js';
import { RNG } from '../docs/src/core/rng.js';

test('morning rush: no overlaps, no red-light running, trips keep completing', async () => {
  const w = await world({ scenario: 'weekday', startHour: 7.25, sample: 0.25, seed: 11 });
  const tr = w.traffic;
  let checks = 0;
  for (let step = 0; step < 2 * 60 * 50; step++) {
    w.tick(0.5, 0.01);
    if (step % 60 !== 0) continue;
    checks++;
    for (const lane of tr.active) {
      const arr = tr.laneCars[lane];
      for (let i = 1; i < arr.length; i++) {
        const lead = arr[i - 1];
        const v = arr[i];
        assert.ok(lead.s >= v.s, 'lane order is front to back');
        if (v.siren || lead.siren || lead.pull > 0.2) continue;
        // Bodies may touch under hard braking but never pass through each other.
        assert.ok(lead.s - lead.len - v.s > -1.0, `overlap ${(lead.s - lead.len - v.s).toFixed(2)} m on edge ${tr.laneEdge[lane]}`);
      }
    }
  }
  const st = w.stats();
  assert.ok(checks > 50);
  assert.equal(tr.redViolations, 0, 'no ordinary vehicle crosses on red');
  assert.ok(st.completed > 2500, `${st.completed} trips completed`);
  assert.ok(st.lifted < st.completed * 0.02, `${st.lifted} vehicles lifted out of gridlock`);
  assert.ok(st.avgSpeedKmh > 15, `average speed ${st.avgSpeedKmh.toFixed(1)} km/h`);
});

test('pose follows the road with lane offset and a unit heading', async () => {
  const w = await world({ scenario: 'weekday', startHour: 8, sample: 0.15, seed: 5 });
  for (let i = 0; i < 600; i++) w.tick(0.5, 0.01);
  const out = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
  let n = 0;
  for (const v of w.vehicles) {
    if (v.leaving || v.onScene) continue;
    w.pose(v, out);
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z));
    assert.ok(Math.abs(Math.hypot(out.dx, out.dy, out.dz) - 1) < 1e-3);
    const seg = w.net.nearestSegment(out.x, out.z, 200);
    assert.ok(seg && seg.dist < 25, 'vehicle sits on a road');
    if (++n > 400) break;
  }
  assert.ok(n > 50);
});

test('a car blocked for a minute inches into a real-world gap, and not before', async () => {
  const d = await data();
  const net = d.roads;
  const signals = new Signals(net, new RNG(7));
  const tr = new Traffic(net, signals, new RNG(8));
  tr.setSample(0.5);
  // A plain bend: one-lane road into one-lane road, no control, nothing else joining.
  let e = -1;
  let ne = -1;
  for (let k = 0; k < net.edgeCount && e < 0; k++) {
    const node = net.to[k];
    if (net.lanes[k] > 1 || net.ctrl[k] !== 0 || net.len[k] < 40 || !tr.nodeSimple[node]) continue;
    if (net.outStart[node + 1] - net.outStart[node] !== 1) continue;
    const o = net.outEdges[net.outStart[node]];
    if (net.lanes[o] > 1 || net.len[o] < 60 || net.to[o] === net.from[k]) continue;
    e = k;
    ne = o;
  }
  assert.ok(e >= 0, 'found a bend');
  // A parked car on the next road leaves room for one real car, but not for a sampled one.
  const L = VEHICLE_TYPES.sedan.len;
  const tail = tr.spawn({ route: [ne], type: 'sedan', startS: L + L + 1, destS: net.len[ne] - 1 }, 0);
  tail.onScene = true;
  const v = tr.spawn({ route: [e, ne], type: 'sedan', startS: net.len[e] - 1.5, destS: net.len[ne] - 1 }, 0);
  v.v = 0;
  v.waitT = 10;
  let t = 0;
  for (let i = 0; i < 40; i++) tr.step(0.5, (t += 0.5));
  assert.equal(v.edge, e, 'waits while the gap is shorter than a sampled car');
  v.waitT = 61;
  for (let i = 0; i < 60; i++) tr.step(0.5, (t += 0.5));
  assert.equal(v.edge, ne, 'squeezes in after a minute');
  assert.ok(tail.s - tail.len - v.s >= 0.4, `real gap ${(tail.s - tail.len - v.s).toFixed(2)} m`);
});

test('a queue leaves a green light at about 1,800 cars an hour per lane', async () => {
  const d = await data();
  const net = d.roads;
  const signals = new Signals(net, new RNG(1));
  signals.state = () => 'G';
  const tr = new Traffic(net, signals, new RNG(2));
  tr.setSample(1);
  // A long one-lane signalized approach with a long straight road beyond it.
  let e = -1;
  let o = -1;
  for (let k = 0; k < net.edgeCount && e < 0; k++) {
    if (net.ctrl[k] !== 3 || signals.controllerOf[k] < 0 || net.lanes[k] !== 1 || net.len[k] < 250) continue;
    const node = net.to[k];
    for (let j = net.outStart[node]; j < net.outStart[node + 1]; j++) {
      const n = net.outEdges[j];
      if (net.len[n] >= 300 && net.to[n] !== net.from[k] && Math.abs(tr.turnAngle(k, n)) < 0.3) {
        e = k;
        o = n;
        break;
      }
    }
  }
  assert.ok(e >= 0, 'found an approach');
  const crossed = [];
  tr.onEdgeExit = (edge, v, now) => {
    if (edge === e) crossed.push(now);
  };
  const L = VEHICLE_TYPES.sedan.len;
  for (let i = 0; i < 24; i++) {
    const v = tr.spawn({ route: [e, o], type: 'sedan', startS: net.len[e] - 2 - i * (L + 2.2), destS: net.len[o] - 1 }, 0);
    if (v) v.v = 0;
  }
  let t = 0;
  for (let i = 0; i < 200; i++) tr.step(0.5, (t += 0.5));
  assert.ok(crossed.length >= 20, `${crossed.length} cars crossed`);
  // Steady discharge after the first few cars get going.
  const headway = (crossed[crossed.length - 1] - crossed[4]) / (crossed.length - 5);
  assert.ok(headway < 2.2 && headway > 1.5, `headway ${headway.toFixed(2)} s (${(3600 / headway).toFixed(0)} cars an hour)`);
});

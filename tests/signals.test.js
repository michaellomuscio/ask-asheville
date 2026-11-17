import test from 'node:test';
import assert from 'node:assert/strict';
import { data } from './helpers.js';
import { Signals, YELLOW } from '../docs/src/sim/signals.js';
import { RNG } from '../docs/src/core/rng.js';

test('signals are built for the signalized junctions in the map', async () => {
  const d = await data();
  const s = new Signals(d.roads, new RNG(1));
  assert.ok(s.controllers.length > 200, `${s.controllers.length} controllers`);
  for (const c of s.controllers) {
    assert.ok(c.cycle >= 50 && c.cycle <= 140, `cycle ${c.cycle}`);
  }
});

test('approaches in different phases are never green at the same time', async () => {
  const d = await data();
  const s = new Signals(d.roads, new RNG(2));
  for (const c of s.controllers) {
    for (let t = 0; t < c.cycle; t += 1.5) {
      const greenPhases = new Set();
      for (const e of c.approaches) {
        if (s.phaseOf[e] < 0) continue;
        const st = s.state(e, t);
        if (st === 'G' || st === 'Y') greenPhases.add(s.phaseOf[e]);
      }
      assert.ok(greenPhases.size <= 1, `controller ${c.id} has ${greenPhases.size} phases moving at t=${t}`);
    }
  }
});

test('every approach gets a green each cycle, followed by yellow', async () => {
  const d = await data();
  const s = new Signals(d.roads, new RNG(3));
  for (const c of s.controllers.slice(0, 120)) {
    for (const e of c.approaches) {
      if (s.phaseOf[e] < 0) continue;
      let green = 0;
      let sawYellowAfterGreen = false;
      let last = null;
      for (let t = 0; t < c.cycle * 2; t += 0.5) {
        const st = s.state(e, t);
        if (st === 'G') green += 0.5;
        if (last === 'G' && st === 'Y') sawYellowAfterGreen = true;
        assert.ok(!(last === 'G' && st === 'R'), 'green must turn yellow before red');
        last = st;
      }
      assert.ok(green >= 2 * 9, `approach ${e} green ${green} s over two cycles`);
      assert.ok(sawYellowAfterGreen);
    }
  }
  assert.equal(YELLOW, 4);
});

test('actuated signals size each green to its queue and keep phases apart', async () => {
  const d = await data();
  const net = d.roads;
  const s = new Signals(net, new RNG(4));
  const c = s.controllers.find((k) => k.actuated && k.phases[0].edges.length && k.phases[1].edges.length);
  assert.ok(c, 'an actuated two-phase signal');
  // A stand-in for the traffic model: a queue of 14 cars on one cross-street approach only.
  const laneStart = {};
  const laneCars = [];
  for (const e of c.approaches) laneStart[e] = e * 8;
  const e1 = c.phases[1].edges[0];
  laneCars[e1 * 8] = Array.from({ length: 14 }, (_, k) => ({ s: net.len[e1] - 2 - 7 * k, v: 0 }));
  const traffic = { capScale: 1, laneStart, laneCars };
  let t = c.planStart + c.cycle;
  for (let k = 0; k < 3; k++) {
    s.update(t, traffic);
    t = c.planStart + c.cycle;
  }
  const [g0, g1] = c.phases.map((p) => p.green);
  assert.ok(g1 > g0 + 10, `queued phase green ${g1.toFixed(1)} s vs empty phase ${g0.toFixed(1)} s`);
  assert.ok(g0 >= 10 && c.cycle <= 140, `min green ${g0}, cycle ${c.cycle}`);
  for (let tt = c.planStart; tt < c.planStart + c.cycle; tt += 0.5) {
    const moving = new Set();
    for (const e of c.approaches) {
      const st = s.state(e, tt);
      if (st === 'G' || st === 'Y') moving.add(s.phaseOf[e]);
    }
    assert.ok(moving.size <= 1, `two phases moving at ${tt}`);
  }
});

test('signal detectors see a queue that backs up past a short approach', async () => {
  const d = await data();
  const net = d.roads;
  const s = new Signals(net, new RNG(5));
  // A two-phase signal whose cross-street approach is a short stub with a road leading into it.
  let pick = null;
  for (const c of s.controllers) {
    if (!c.actuated || !c.phases[0].edges.length) continue;
    for (const e of c.phases[1].edges) {
      if (net.len[e] > 60 || net.cls[e] === 1 || net.cls[e] === 3) continue;
      const n0 = net.from[e];
      for (let k = net.inStart[n0]; k < net.inStart[n0 + 1]; k++) {
        const pe = net.inEdges[k];
        if (net.from[pe] !== net.to[e] && net.len[pe] > 120 && s.controllerOf[pe] < 0) pick = { c, e, pe };
      }
      if (pick) break;
    }
    if (pick) break;
  }
  assert.ok(pick, 'found a short approach');
  const { c, e, pe } = pick;
  const laneStart = {};
  const laneCars = [];
  for (const a of c.approaches) laneStart[a] = a * 8;
  laneStart[pe] = pe * 8;
  laneCars[pe * 8] = Array.from({ length: 12 }, (_, k) => ({ s: net.len[pe] - 2 - 7 * k, v: 0, route: [pe, e], ri: 0 }));
  const traffic = { capScale: 1, laneStart, laneCars };
  let t = c.planStart + c.cycle;
  for (let k = 0; k < 3; k++) {
    s.update(t, traffic);
    t = c.planStart + c.cycle;
  }
  assert.ok(c.phases[1].green > c.phases[0].green + 5, `queued phase ${c.phases[1].green.toFixed(1)} s vs ${c.phases[0].green.toFixed(1)} s`);
});

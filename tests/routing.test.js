import test from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';
import { CTRL } from '../docs/src/sim/graph.js';

test('drivers route expecting the usual wait at signals and stop signs; drive times stay live', async () => {
  const w = await world({ scenario: 'weekday', startHour: 3, sample: 0.1, seed: 3 });
  const net = w.net;
  const live = w.liveWeights();
  const route = w.routingWeights();
  let signals = 0;
  let stops = 0;
  for (let e = 0; e < net.edgeCount; e++) {
    if (net.cls[e] === 13) continue;
    const expected = live[e] + w.traffic.ctrlDelay[e];
    assert.ok(Math.abs(route[e] - expected) < 1e-3 * Math.max(1, expected), `edge ${e}: ${route[e]} vs ${expected}`);
    assert.equal(live[e], net.ffTime[e] * w.traffic.congestion[e]);
    if (net.ctrl[e] === CTRL.SIGNAL && w.signals.controllerOf[e] >= 0) {
      signals++;
      assert.ok(w.traffic.ctrlDelay[e] > 0, 'a signal costs time');
    } else if (net.ctrl[e] === CTRL.STOP) {
      stops++;
      assert.equal(w.traffic.ctrlDelay[e], 5);
    }
  }
  assert.ok(signals > 200 && stops > 100, `${signals} signal approaches, ${stops} stop approaches`);
});

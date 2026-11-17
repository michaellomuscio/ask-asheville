import test from 'node:test';
import assert from 'node:assert/strict';
import { world, picker } from './helpers.js';
import { RESPONSE } from '../docs/src/sim/emergency.js';

test('dispatch sends the station with the shortest drive time', async () => {
  const w = await world({ scenario: 'weekday', startHour: 3, sample: 0.1, seed: 4 });
  const em = w.emergency;
  const pick = picker(9);
  const b = w.data.buildings;
  for (let k = 0; k < 6; k++) {
    let i;
    do i = pick(b.count); while (b.residents[i] === 0);
    const inc = em.call({ type: 'fire', x: b.x[i], z: b.z[i] });
    const first = inc.units.reduce((m, u) => (u.etaSec < m.etaSec ? u : m), inc.units[0]);
    // Brute force: every fire station's drive time to the scene.
    const wts = em.emergencyWeights(true);
    let best = Infinity;
    for (const st of em.stations.filter((s) => s.kind === 'fire')) {
      const r = w.router.route(st.node, inc.node, wts, { maxSpeed: w.net.maxSpeed * 1.3 });
      if (r) best = Math.min(best, r.time);
    }
    const expected = RESPONSE.callProcessing + RESPONSE.turnout.fire + best;
    assert.ok(Math.abs(first.etaSec - expected) < 1, `chosen ${first.etaSec.toFixed(1)} vs best ${expected.toFixed(1)}`);
    for (const u of inc.units) u.unit.busy = false;
  }
});

test('every populated place has a finite response time', async () => {
  const w = await world({ scenario: 'weekday', startHour: 3, sample: 0.1 });
  const b = w.data.buildings;
  for (const kind of ['fire', 'ems', 'police', 'hospital']) {
    const T = w.emergency.responseTimes(kind);
    let bad = 0;
    for (let i = 0; i < b.count; i++) if (b.residents[i] > 0 && !(T[b.node[i]] < Infinity)) bad++;
    assert.equal(bad, 0, `${kind}: ${bad} homes unreachable`);
  }
  // A hypothetical station never makes coverage worse.
  const base = w.emergency.responseTimes('fire');
  const node = w.net.nearestNode(15000, -10000);
  const extra = w.emergency.responseTimes('fire', { extra: [node] });
  for (let i = 0; i < base.length; i += 97) assert.ok(extra[i] <= base[i] + 1e-3);
});

test('a medical call ends at an emergency department', async () => {
  const w = await world({ scenario: 'weekday', startHour: 2, sample: 0.05, seed: 8 });
  const inc = w.emergency.call({ type: 'medical', x: 0, z: 0 });
  for (let i = 0; i < 2 * 60 * 60 && inc.status !== 'closed'; i++) w.tick(0.5, 0.01);
  assert.equal(inc.status, 'closed');
  assert.ok(inc.responseSec > 60 && inc.responseSec < 1200, `response ${inc.responseSec}`);
  assert.ok(inc.hospital && /Mission|ER/.test(inc.hospital.name), `hospital ${inc.hospital?.name}`);
  assert.ok(inc.transport && inc.transport.arrived);
});

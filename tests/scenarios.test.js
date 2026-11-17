import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScenario } from '../docs/src/sim/scenarios.js';

test('restarting a resolved scenario keeps its events on', () => {
  const first = resolveScenario('tourists_game');
  assert.deepEqual(first.events.filter((e) => e.active).map((e) => e.id), ['tourists']);
  const again = resolveScenario(first);
  assert.deepEqual(again.events.filter((e) => e.active).map((e) => e.id), ['tourists']);
  assert.equal(again.events.find((e) => e.id === 'tourists').attendance, 3100);
  // A copy, not the same objects.
  assert.notEqual(again.events[0], first.events[0]);
});

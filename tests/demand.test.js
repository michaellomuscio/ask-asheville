import test from 'node:test';
import assert from 'node:assert/strict';
import { world } from './helpers.js';

test('weekday commute volumes are on the LODES scale', async () => {
  const w = await world({ scenario: 'weekday', startHour: 5, sample: 0.2 });
  const s = w.demandMaker.summary;
  // ~167k LODES workers touching the county; ~85% work on a weekday; most drive alone.
  assert.ok(s.commuters > 70000 && s.commuters < 125000, `${s.commuters} commuting vehicles`);
  assert.ok(s.schoolTrips > 15000, `${s.schoolTrips} school trips`);
  assert.ok(s.toursPerDay > 120000 && s.toursPerDay < 260000, `${s.toursPerDay} errand tours`);
});

test('school traffic only on school days, commutes shrink on weekends', async () => {
  const w = await world({ scenario: 'weekday', startHour: 5, sample: 0.2 });
  const weekday = w.demandMaker.summary;
  w.setScenario('saturday');
  const sat = w.demandMaker.summary;
  w.setScenario('summer');
  const summer = w.demandMaker.summary;
  w.setScenario('thanksgiving_eve');
  const tg = w.demandMaker.summary;
  assert.equal(sat.schoolTrips, 0);
  assert.equal(summer.schoolTrips, 0);
  assert.equal(tg.schoolTrips, 0);
  assert.ok(weekday.schoolTrips > 0);
  assert.ok(sat.commuters < weekday.commuters * 0.4, `Saturday commuters ${sat.commuters}`);
});

test('events add arrival and departure trips', async () => {
  const w = await world({ scenario: 'tourists_game', sample: 0.2 });
  assert.ok(w.demandMaker.summary.eventTrips > 1500, `${w.demandMaker.summary.eventTrips} event trips`);
  const ev = w.events.find((e) => e.id === 'tourists');
  assert.ok(ev.active);
  const before = w.future.size;
  w.setEvent('orange_peel', { active: true });
  assert.ok(w.future.size > before, 'switching an event on schedules its trips');
});

test('every corridor connects to the county network in the right direction', async () => {
  const w = await world({ scenario: 'weekday', startHour: 5, sample: 0.2 });
  const net = w.net;
  const hub = w.data.focus.node;
  const toHub = w.router.dijkstra([hub], net.ffTime, { reverse: true });
  const fromHub = w.router.dijkstra([hub], net.ffTime);
  for (const c of w.demandMaker.corridors) {
    for (const n of c.enter) assert.ok(toHub[n] < Infinity, `${c.id} entry ${n}`);
    for (const n of c.exit) assert.ok(fromHub[n] < Infinity, `${c.id} exit ${n}`);
  }
});

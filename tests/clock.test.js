import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock, easternOffset, holidayName, isSchoolDay, thanksgiving } from '../docs/src/sim/clock.js';

test('sunrise and sunset in Asheville', () => {
  const c = new Clock({ date: '2026-10-14', hour: 12 });
  const t = c.sunTimes();
  assert.ok(Math.abs(t.sunrise - 7.6) < 0.1, `sunrise ${t.sunrise}`);
  assert.ok(Math.abs(t.sunset - 18.94) < 0.1, `sunset ${t.sunset}`);
  const june = new Clock({ date: '2026-06-21' }).sunTimes();
  assert.ok(june.sunrise > 6.0 && june.sunrise < 6.5 && june.sunset > 20.5 && june.sunset < 21.0, JSON.stringify(june));
  const dec = new Clock({ date: '2026-12-21' }).sunTimes();
  assert.ok(dec.sunrise > 7.3 && dec.sunrise < 7.8 && dec.sunset > 17.1 && dec.sunset < 17.5, JSON.stringify(dec));
});

test('the sun is up at noon and down at midnight, east in the morning', () => {
  const c = new Clock({ date: '2026-10-14', hour: 13 });
  const d = c.sunDirection();
  assert.ok(d[1] > 0.5);
  c.setHour(0);
  assert.ok(c.sunDirection()[1] < -0.3);
  c.setHour(8.5);
  assert.ok(c.sunDirection()[0] > 0.5, 'morning sun is in the east (+x)');
});

test('daylight saving time, holidays and school days', () => {
  assert.equal(easternOffset(2026, 3, 7), -5);
  assert.equal(easternOffset(2026, 3, 9), -4);
  assert.equal(easternOffset(2026, 11, 2), -5);
  assert.deepEqual(thanksgiving(2026), { y: 2026, m: 11, d: 26 });
  assert.equal(holidayName(2026, 11, 27), 'Black Friday');
  assert.equal(holidayName(2026, 7, 4), 'Independence Day');
  assert.ok(isSchoolDay(2026, 10, 14));
  assert.ok(!isSchoolDay(2026, 7, 15));
  assert.ok(!isSchoolDay(2026, 11, 25));
  assert.ok(!isSchoolDay(2026, 10, 17));
  const c = new Clock({ date: '2026-12-31', hour: 23.9 });
  c.advance(3600);
  assert.equal(c.iso, '2027-01-01');
});

test('day of year follows the date (drives leaf color and season)', async () => {
  const { Clock } = await import('../docs/src/sim/clock.js');
  const c = new Clock();
  c.setDate({ y: 2026, m: 10, d: 14 });
  assert.equal(c.dayOfYear, 287);
  c.setDate({ y: 2026, m: 8, d: 21 });
  assert.equal(c.dayOfYear, 233);
  c.setDate({ y: 2026, m: 1, d: 1 });
  assert.equal(c.dayOfYear, 1);
});

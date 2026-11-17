// Calendar and time of day in Asheville (America/New_York, with daylight saving time),
// the real positions of the sun and moon, holidays and school days, and the daily rhythms
// the renderer uses for lit windows.

export const LAT = 35.595;
export const LON = -82.551;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const RAD = Math.PI / 180;

// --- Calendar helpers (civil dates as {y, m (1-12), d}) ----------------------------------

const dayIndex = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000);
const weekday = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

/** Day of month of the n-th `wd` (0 = Sunday) in month m; n = -1 for the last one. */
function nthWeekday(y, m, wd, n) {
  if (n > 0) {
    const first = weekday(y, m, 1);
    return 1 + ((wd - first + 7) % 7) + (n - 1) * 7;
  }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lw = weekday(y, m, last);
  return last - ((lw - wd + 7) % 7);
}

/** Eastern time offset from UTC in hours for a civil date and local hour. */
export function easternOffset(y, m, d, hour = 12) {
  const start = nthWeekday(y, 3, 0, 2); // second Sunday in March, 2 a.m.
  const end = nthWeekday(y, 11, 0, 1); // first Sunday in November, 2 a.m.
  const t = dayIndex(y, m, d) + hour / 24;
  const t0 = dayIndex(y, 3, start) + 2 / 24;
  const t1 = dayIndex(y, 11, end) + 2 / 24;
  return t >= t0 && t < t1 ? -4 : -5;
}

export function thanksgiving(y) {
  return { y, m: 11, d: nthWeekday(y, 11, 4, 4) };
}

/** Name of the holiday on this civil date, or null. Includes the big travel/shopping days. */
export function holidayName(y, m, d) {
  const tg = thanksgiving(y).d;
  if (m === 1 && d === 1) return "New Year's Day";
  if (m === 1 && d === nthWeekday(y, 1, 1, 3)) return 'Martin Luther King Jr. Day';
  if (m === 2 && d === nthWeekday(y, 2, 1, 3)) return "Presidents' Day";
  if (m === 5 && d === nthWeekday(y, 5, 1, -1)) return 'Memorial Day';
  if (m === 6 && d === 19) return 'Juneteenth';
  if (m === 7 && d === 4) return 'Independence Day';
  if (m === 9 && d === nthWeekday(y, 9, 1, 1)) return 'Labor Day';
  if (m === 11 && d === 11) return 'Veterans Day';
  if (m === 11 && d === tg - 1) return 'Thanksgiving Eve';
  if (m === 11 && d === tg) return 'Thanksgiving';
  if (m === 11 && d === tg + 1) return 'Black Friday';
  if (m === 12 && d === 24) return 'Christmas Eve';
  if (m === 12 && d === 25) return 'Christmas';
  if (m === 12 && d === 31) return "New Year's Eve";
  return null;
}

/** Days most workplaces close (Thanksgiving Eve, Black Friday and the eves stay working days). */
export function isWorkHoliday(y, m, d) {
  const h = holidayName(y, m, d);
  return !!h && !['Thanksgiving Eve', 'Black Friday', 'Christmas Eve', "New Year's Eve", 'Veterans Day', 'Juneteenth'].includes(h);
}

/**
 * Approximate public-school calendar for Buncombe County and Asheville City Schools:
 * weekdays from mid-August to early June, minus holidays, Thanksgiving week's Wed-Fri,
 * winter break and a spring break week in early April.
 */
export function isSchoolDay(y, m, d) {
  const wd = weekday(y, m, d);
  if (wd === 0 || wd === 6) return false;
  const h = holidayName(y, m, d);
  if (h && h !== 'Veterans Day') return false;
  const t = dayIndex(y, m, d);
  if (t >= dayIndex(y, 6, 6) && t <= dayIndex(y, 8, 13)) return false; // summer
  if ((m === 12 && d >= 20) || (m === 1 && d <= 3)) return false; // winter break
  const tg = thanksgiving(y).d;
  if (m === 11 && d >= tg - 1 && d <= tg + 1) return false;
  const sb = nthWeekday(y, 4, 1, 1); // spring break: first full week of April
  if (m === 4 && d >= sb && d < sb + 5) return false;
  return true;
}

// --- Sun and moon -------------------------------------------------------------------------

/** Julian day for a UTC epoch in milliseconds. */
const julian = (ms) => ms / 86400000 + 2440587.5;

/**
 * NOAA solar position. Returns {azimuth (deg clockwise from north), elevation (deg, refraction
 * corrected), declination, eqTime (min)} for a UTC instant.
 */
export function solarPosition(ms, lat = LAT, lon = LON) {
  const jc = (julian(ms) - 2451545) / 36525;
  const L0 = (280.46646 + jc * (36000.76983 + jc * 0.0003032)) % 360;
  const M = 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
  const e = 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
  const C = Math.sin(M * RAD) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * jc)
    + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * jc;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const obliq0 = 23 + (26 + (21.448 - jc * (46.815 + jc * (0.00059 - jc * 0.001813))) / 60) / 60;
  const obliq = obliq0 + 0.00256 * Math.cos(omega * RAD);
  const decl = Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD)) / RAD;
  const y = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime = 4 / RAD * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD) + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));
  const utcMin = ((ms / 60000) % 1440 + 1440) % 1440;
  const tst = ((utcMin + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const ha = tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180;
  const cz = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const zen = Math.acos(Math.max(-1, Math.min(1, cz))) / RAD;
  let elev = 90 - zen;
  // Atmospheric refraction (NOAA approximation).
  if (elev < 85) {
    const te = Math.tan(elev * RAD);
    let r;
    if (elev > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
    else if (elev > -0.575) r = 1735 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    else r = -20.772 / te;
    elev += r / 3600;
  }
  const ca = (Math.sin(lat * RAD) * Math.cos(zen * RAD) - Math.sin(decl * RAD)) / (Math.cos(lat * RAD) * Math.sin(zen * RAD) || 1e-9);
  const a = Math.acos(Math.max(-1, Math.min(1, ca))) / RAD;
  const azimuth = ha > 0 ? (a + 180) % 360 : (540 - a) % 360;
  return { azimuth, elevation: elev, declination: decl, eqTime };
}

/** Low-precision lunar position (about 1 degree) and illuminated fraction. */
export function lunarPosition(ms, lat = LAT, lon = LON) {
  const d = julian(ms) - 2451545;
  const L = (218.316 + 13.176396 * d) * RAD;
  const M = (134.963 + 13.064993 * d) * RAD;
  const F = (93.272 + 13.22935 * d) * RAD;
  const lam = L + 6.289 * RAD * Math.sin(M);
  const beta = 5.128 * RAD * Math.sin(F);
  const eps = 23.4397 * RAD;
  const ra = Math.atan2(Math.sin(lam) * Math.cos(eps) - Math.tan(beta) * Math.sin(eps), Math.cos(lam));
  const dec = Math.asin(Math.sin(beta) * Math.cos(eps) + Math.cos(beta) * Math.sin(eps) * Math.sin(lam));
  const theta = (280.16 + 360.9856235 * d) * RAD + lon * RAD;
  const H = theta - ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Azimuth from south toward west, then turned to clockwise-from-north.
  const azS = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const azimuth = ((azS / RAD + 180) % 360 + 360) % 360;
  // Phase from the sun's ecliptic longitude.
  const jc = d / 36525;
  const sunLon = (280.46646 + 36000.76983 * jc + 1.9146 * Math.sin((357.52911 + 35999.05029 * jc) * RAD)) * RAD;
  const elong = Math.acos(Math.cos(lam - sunLon) * Math.cos(beta));
  const illumination = (1 - Math.cos(elong)) / 2;
  return { azimuth, elevation: alt / RAD, illumination };
}

/** Unit vector toward a body in renderer axes: x east, y up, z south. */
function toVector(azimuth, elevation, out) {
  const az = azimuth * RAD;
  const el = elevation * RAD;
  out[0] = Math.sin(az) * Math.cos(el);
  out[1] = Math.sin(el);
  out[2] = -Math.cos(az) * Math.cos(el);
  return out;
}

// --- Clock -------------------------------------------------------------------------------

export class Clock {
  /**
   * @param {object} [o]
   * @param {string} [o.date] civil date 'YYYY-MM-DD' in Asheville
   * @param {number} [o.hour] local time of day
   */
  constructor({ date = '2026-10-14', hour = 6.5 } = {}) {
    this.setDate(date);
    this.t = hour * 3600;
    this._sun = null;
    this._sunKey = -1;
  }

  /** Accepts 'YYYY-MM-DD', a Date (read as Eastern civil date) or {y, m, d}. */
  setDate(date) {
    if (typeof date === 'string') {
      const [y, m, d] = date.split('-').map(Number);
      this.y = y;
      this.m = m;
      this.d = d;
    } else if (date instanceof Date) {
      const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric' })
        .formatToParts(date);
      const get = (t) => Number(parts.find((p) => p.type === t).value);
      this.y = get('year');
      this.m = get('month');
      this.d = get('day');
    } else {
      this.y = date.y;
      this.m = date.m;
      this.d = date.d;
    }
    this.day = dayIndex(this.y, this.m, this.d);
    this.onDayChange?.();
  }

  advance(simSeconds) {
    this.t += simSeconds;
    while (this.t >= 86400) {
      this.t -= 86400;
      this.nextDay(1);
    }
    while (this.t < 0) {
      this.t += 86400;
      this.nextDay(-1);
    }
  }

  nextDay(step) {
    const dt = new Date(Date.UTC(this.y, this.m - 1, this.d + step));
    this.setDate({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
  }

  setHour(h) {
    this.t = ((h % 24) + 24) % 24 * 3600;
  }

  get hour() {
    return this.t / 3600;
  }

  /** Day of the year, 1-366. The renderer uses it for leaf color, snow and the season. */
  get dayOfYear() {
    return Math.round((Date.UTC(this.y, this.m - 1, this.d) - Date.UTC(this.y, 0, 0)) / 86400000);
  }

  /** Seconds since midnight (alias used by older code). */
  get seconds() {
    return this.t;
  }

  get iso() {
    return `${this.y}-${String(this.m).padStart(2, '0')}-${String(this.d).padStart(2, '0')}`;
  }

  /** UTC epoch milliseconds of the current instant. */
  get ms() {
    const off = easternOffset(this.y, this.m, this.d, this.hour);
    return Date.UTC(this.y, this.m - 1, this.d) + (this.t - off * 3600) * 1000;
  }

  /** The current instant as a Date (format with timeZone 'America/New_York'). */
  get date() {
    return new Date(this.ms);
  }

  get dayOfWeek() {
    return weekday(this.y, this.m, this.d);
  }

  get weekdayName() {
    return DAYS[this.dayOfWeek];
  }

  get weekend() {
    const w = this.dayOfWeek;
    return w === 0 || w === 6;
  }

  get holiday() {
    return holidayName(this.y, this.m, this.d);
  }

  get schoolDay() {
    return isSchoolDay(this.y, this.m, this.d);
  }

  /** "weekday" | "saturday" | "sunday" | "holiday" (work holidays count as Sundays for traffic). */
  get dayType() {
    if (isWorkHoliday(this.y, this.m, this.d)) return 'holiday';
    const w = this.dayOfWeek;
    return w === 6 ? 'saturday' : w === 0 ? 'sunday' : 'weekday';
  }

  /** "07:42" */
  label() {
    const m = Math.floor(this.t / 60);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  }

  /** "7:42 AM" */
  label12() {
    const m = Math.floor(this.t / 60);
    const h = Math.floor(m / 60);
    return `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  }

  dateLabel() {
    return `${DAYS[this.dayOfWeek]}, ${MONTHS[this.m - 1]} ${this.d}, ${this.y}`;
  }

  shortDateLabel() {
    return `${DAYS[this.dayOfWeek].slice(0, 3)} ${MONTHS[this.m - 1].slice(0, 3)} ${this.d}`;
  }

  sun() {
    // Recompute at most every 20 simulated seconds.
    const key = Math.floor(this.ms / 20000);
    if (key !== this._sunKey) {
      this._sunKey = key;
      this._sun = solarPosition(this.ms);
      this._moon = lunarPosition(this.ms);
    }
    return this._sun;
  }

  moon() {
    this.sun();
    return this._moon;
  }

  /** Unit vector toward the sun (x east, y up, z south). */
  sunDirection(out = [0, 0, 0]) {
    const s = this.sun();
    return toVector(s.azimuth, s.elevation, out);
  }

  /** Unit vector toward the moon (x east, y up, z south). */
  moonDirection(out = [0, 0, 0]) {
    const m = this.moon();
    return toVector(m.azimuth, m.elevation, out);
  }

  get moonIllumination() {
    return this.moon().illumination;
  }

  /** Local sunrise and sunset (hours) for the current date. */
  sunTimes() {
    const off = easternOffset(this.y, this.m, this.d, 12);
    const noonMs = Date.UTC(this.y, this.m - 1, this.d) + (12 - off) * 3600000;
    const p = solarPosition(noonMs);
    const cosHa = Math.cos(90.833 * RAD) / (Math.cos(LAT * RAD) * Math.cos(p.declination * RAD)) - Math.tan(LAT * RAD) * Math.tan(p.declination * RAD);
    const ha = Math.acos(Math.max(-1, Math.min(1, cosHa))) / RAD;
    const noon = (720 - 4 * LON - p.eqTime + off * 60) / 60;
    return { sunrise: noon - (ha * 4) / 60, sunset: noon + (ha * 4) / 60, noon };
  }
}

/** Free function versions for code that only has a timestamp. */
export function sunDirectionAt(ms, out = [0, 0, 0]) {
  const s = solarPosition(ms);
  return toVector(s.azimuth, s.elevation, out);
}

export function moonDirectionAt(ms, out = [0, 0, 0]) {
  const m = lunarPosition(ms);
  return toVector(m.azimuth, m.elevation, out);
}

// --- Daily rhythms used by the renderer ---------------------------------------------------

/** Piecewise-linear lookup in a 24-entry hourly table, wrapping at midnight. */
export function hourly(table, hour) {
  const h = ((hour % 24) + 24) % 24;
  const i = Math.floor(h);
  const t = h - i;
  return table[i] + (table[(i + 1) % 24] - table[i]) * t;
}

// Share of windows lit, by building use (office, residential, retail, industrial, civic).
const LIT = [
  [0.08, 0.06, 0.06, 0.06, 0.06, 0.08, 0.2, 0.55, 0.8, 0.85, 0.85, 0.85, 0.82, 0.85, 0.85, 0.85, 0.82, 0.72, 0.5, 0.32, 0.22, 0.16, 0.12, 0.1],
  [0.14, 0.08, 0.05, 0.04, 0.04, 0.1, 0.24, 0.3, 0.2, 0.12, 0.1, 0.1, 0.12, 0.12, 0.12, 0.15, 0.24, 0.38, 0.5, 0.56, 0.56, 0.5, 0.4, 0.25],
  [0.08, 0.06, 0.06, 0.06, 0.06, 0.08, 0.2, 0.5, 0.85, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.92, 0.85, 0.7, 0.4, 0.15, 0.1],
  [0.45, 0.45, 0.45, 0.45, 0.45, 0.5, 0.65, 0.8, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.85, 0.8, 0.7, 0.6, 0.5, 0.48, 0.46, 0.45, 0.45],
  [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.6, 0.9, 0.92, 0.92, 0.92, 0.92, 0.92, 0.92, 0.9, 0.85, 0.7, 0.55, 0.5, 0.45, 0.35, 0.25, 0.2],
];

export function litShare(useCode, hour) {
  return hourly(LIT[useCode] || LIT[0], hour);
}

// Share of a building's people present, used by the inspector.
const PRESENCE = {
  residential: [0.95, 0.96, 0.97, 0.97, 0.96, 0.93, 0.85, 0.65, 0.42, 0.35, 0.33, 0.35, 0.38, 0.36, 0.36, 0.4, 0.5, 0.65, 0.78, 0.85, 0.9, 0.92, 0.94, 0.95],
  office: [0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.06, 0.35, 0.8, 0.95, 0.97, 0.9, 0.75, 0.88, 0.95, 0.93, 0.85, 0.55, 0.22, 0.1, 0.06, 0.04, 0.03, 0.02],
  retail: [0.02, 0.01, 0.01, 0.01, 0.01, 0.02, 0.1, 0.35, 0.65, 0.8, 0.85, 0.9, 0.95, 0.95, 0.9, 0.9, 0.9, 0.9, 0.85, 0.7, 0.5, 0.25, 0.06, 0.03],
  school: [0, 0, 0, 0, 0, 0, 0.02, 0.4, 0.95, 0.98, 0.98, 0.98, 0.98, 0.98, 0.95, 0.5, 0.15, 0.06, 0.03, 0.02, 0.01, 0, 0, 0],
};

export function presence(use, hour) {
  const key = use === 'hotel' ? 'residential' : use === 'civic' || use === 'industrial' ? 'office' : use;
  return hourly(PRESENCE[key] || PRESENCE.office, hour);
}

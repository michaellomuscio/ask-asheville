// Weather as a slow Markov chain over a few regimes. Rendering reads the smoothed
// parameters (cloud cover, rain, snow, fog, wet roads, lightning); traffic reads the
// speed and demand factors. Snow only happens when a scenario or the user asks for it.

import { clamp } from './constants.js';

export const WEATHER_KINDS = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

const TARGETS = {
  clear: { cloud: 0.16, rain: 0, snow: 0, fog: 0, wind: 0.3 },
  cloudy: { cloud: 0.72, rain: 0, snow: 0, fog: 0.12, wind: 0.5 },
  rain: { cloud: 0.9, rain: 0.6, snow: 0, fog: 0.3, wind: 0.6 },
  storm: { cloud: 1, rain: 1, snow: 0, fog: 0.42, wind: 1 },
  fog: { cloud: 0.4, rain: 0, snow: 0, fog: 1, wind: 0.1 },
  snow: { cloud: 0.95, rain: 0, snow: 1, fog: 0.4, wind: 0.45 },
};

const NEXT = {
  clear: [['clear', 0.4], ['cloudy', 0.45], ['fog', 0.15]],
  cloudy: [['clear', 0.4], ['rain', 0.35], ['cloudy', 0.25]],
  rain: [['cloudy', 0.5], ['rain', 0.25], ['storm', 0.25]],
  storm: [['rain', 0.7], ['cloudy', 0.3]],
  fog: [['clear', 0.55], ['cloudy', 0.45]],
  snow: [['snow', 0.7], ['cloudy', 0.3]],
};

// How much drivers slow down (share of their normal speed) and how much travel happens.
const SPEED = { clear: 1, cloudy: 1, rain: 0.9, storm: 0.82, fog: 0.85, snow: 0.55 };
const DEMAND = { clear: 1, cloudy: 1, rain: 0.97, storm: 0.9, fog: 0.98, snow: 0.6 };

export class Weather {
  constructor(rng, kind = 'clear') {
    this.rng = rng;
    this.auto = true;
    this.kind = kind;
    const t = TARGETS[kind];
    this.cloud = t.cloud;
    this.rain = t.rain;
    this.snow = t.snow;
    this.fog = t.fog;
    this.wind = t.wind;
    this.wet = t.rain > 0 || t.snow > 0 ? 1 : 0;
    this.snowCover = t.snow > 0 ? 1 : 0; // snow lying on the ground, 0..1
    this.timer = rng.range(3, 7) * 3600;
    this.flash = 0;
    this.nextBolt = rng.range(4, 10);
  }

  /** 'auto' lets the weather change on its own; any kind pins it. */
  setMode(mode) {
    if (mode === 'auto') {
      this.auto = true;
      if (this.kind === 'snow') this.kind = 'cloudy';
      this.timer = this.rng.range(2, 5) * 3600;
    } else {
      this.auto = false;
      this.kind = mode;
    }
  }

  get mode() {
    return this.auto ? 'auto' : this.kind;
  }

  /** Share of normal driving speed under the current (smoothed) conditions. */
  speedFactor() {
    const rain = 1 - this.rain * 0.12 - Math.max(0, this.rain - 0.6) * 0.15;
    const snow = 1 - this.snow * 0.45;
    const fog = 1 - this.fog * 0.15;
    return clamp(Math.min(rain, snow, fog), 0.4, 1);
  }

  /** Share of normal trip-making (snow keeps people home). */
  demandFactor() {
    return DEMAND[this.kind] ?? 1;
  }

  update(simDt, realDt) {
    if (this.auto) {
      this.timer -= simDt;
      if (this.timer <= 0) {
        const opts = NEXT[this.kind];
        this.kind = this.rng.weighted(opts.map((o) => o[0]), opts.map((o) => o[1]));
        if (this.kind === 'snow') this.kind = 'cloudy';
        this.timer = this.rng.range(2, 6) * 3600;
      }
    }
    const t = TARGETS[this.kind];
    // Smooth over a few real seconds, or over simulated time when the clock runs fast.
    const k = 1 - Math.exp(-Math.max(realDt / 3, simDt / 1800));
    this.cloud += (t.cloud - this.cloud) * k;
    this.rain += (t.rain - this.rain) * k;
    this.snow += (t.snow - this.snow) * k;
    this.fog += (t.fog - this.fog) * k;
    this.wind += (t.wind - this.wind) * k;
    // Streets get wet quickly in rain or snow and dry over a couple of simulated hours.
    // Snow piles up over about an hour of steady snowfall and melts over most of a day.
    if (this.snow > 0.3) this.snowCover = Math.min(1, this.snowCover + (simDt / 3600) * this.snow);
    else if (this.snowCover > 0) this.snowCover = Math.max(0, this.snowCover - simDt / (14 * 3600));
    const precip = Math.max(this.rain, this.snow * 0.8);
    if (precip > 0.05) this.wet = Math.min(1, this.wet + Math.max(realDt, simDt / 60) * precip * 0.5);
    else this.wet = Math.max(0, this.wet - simDt / 7200);

    this.flash = Math.max(0, this.flash - realDt * 5);
    if (this.kind === 'storm' && this.rain > 0.6) {
      this.nextBolt -= realDt;
      if (this.nextBolt <= 0) {
        this.flash = 1;
        this.nextBolt = this.rng.range(3, 11);
      }
    }
  }

  /**
   * Air temperature (°C) for the HUD: Asheville's normal daily high and low for the month, a
   * daily swing peaking mid-afternoon, and cooling under rain, cloud and snow.
   * @param {number} hour local time of day
   * @param {object|number} [clock] a Clock (its month is used) or a month number (1-12)
   */
  temperature(hour, clock = 10) {
    return Math.round(((this.temperatureF(hour, clock) - 32) * 5) / 9);
  }

  /** Same as temperature() in °F. */
  temperatureF(hour, clock = 10) {
    const month = typeof clock === 'number' ? clock : clock?.m ?? 10;
    // Normal daily high/low (°F) by month at the Asheville airport (1991-2020 normals, rounded).
    const HI = [48, 52, 60, 69, 76, 82, 85, 84, 78, 69, 59, 50];
    const LO = [28, 30, 36, 44, 52, 60, 64, 63, 57, 46, 36, 30];
    const hi = HI[(month - 1 + 12) % 12];
    const lo = LO[(month - 1 + 12) % 12];
    const daily = (Math.sin(((hour - 9) / 24) * Math.PI * 2) + 1) / 2;
    let t = lo + (hi - lo) * daily;
    t -= this.rain * 6 + this.cloud * 3 + this.snow * 8;
    if (this.kind === 'snow' || this.snowCover > 0.5) t = Math.min(t, 31);
    return Math.round(t);
  }
}

export { SPEED as WEATHER_SPEED, DEMAND as WEATHER_DEMAND };

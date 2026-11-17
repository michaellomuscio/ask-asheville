// Small numeric helpers and shared constants for the simulation and the renderer.
// Traffic drives on the right.

export { LANE_W } from './graph.js';

/** Fixed simulation step (s). Larger steps are used at very high clock speeds. */
export const SIM_DT = 0.5;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Seconds since midnight -> "07:42". */
export function hhmm(seconds) {
  const m = Math.floor((((seconds % 86400) + 86400) % 86400) / 60);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Seconds -> "12 min" / "1 h 05 min". */
export function minutesLabel(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

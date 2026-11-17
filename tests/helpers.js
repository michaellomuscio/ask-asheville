// Shared fixtures: the real Buncombe County data, loaded once per test file.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorldData } from '../docs/src/data/worldData.js';
import { World } from '../docs/src/sim/world.js';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/data') + '/';
let cached = null;

export async function data() {
  if (!cached) cached = await loadWorldData(DATA, { terrain: false, water: false });
  return cached;
}

export async function world(opts = {}) {
  return new World(await data(), { budgetMs: Infinity, ...opts });
}

/** Deterministic pseudo-random integers for picking test cases. */
export function picker(seed = 1) {
  let s = seed >>> 0;
  return (n) => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s % n;
  };
}

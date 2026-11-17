// Local projection used everywhere (mirrors pipeline/common.py): meters on a plane centered
// on Pack Square in downtown Asheville, x east, z south.

export const LAT0 = 35.5951;
export const LON0 = -82.551;
const phi = (LAT0 * Math.PI) / 180;
export const M_PER_DEG_LAT = 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
export const M_PER_DEG_LON = 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);

/** lon/lat (degrees) -> {x, z} meters. */
export function project(lon, lat) {
  return { x: (lon - LON0) * M_PER_DEG_LON, z: -(lat - LAT0) * M_PER_DEG_LAT };
}

/** x/z meters -> {lon, lat} degrees. */
export function unproject(x, z) {
  return { lon: LON0 + x / M_PER_DEG_LON, lat: LAT0 - z / M_PER_DEG_LAT };
}

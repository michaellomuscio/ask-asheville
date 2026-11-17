// Click picking: a ray marched against the terrain surface finds the ground point; on the way
// down it tests nearby building footprints and heights, so you can click a tall building
// standing in front of a valley. Vehicles are picked in screen space.

import * as THREE from 'three';

export class Picker {
  constructor(camera, dom, heightAt, buildings) {
    this.camera = camera;
    this.dom = dom;
    this.heightAt = heightAt;
    this.buildings = buildings;
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.v = new THREE.Vector3();
    this.pose = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 };
  }

  rayFrom(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    return this.ray.ray;
  }

  /** Ground hit {x, y, z, t} under a screen point, or null. Also reports a building if one is hit first. */
  ground(clientX, clientY) {
    const r = this.rayFrom(clientX, clientY);
    const o = r.origin;
    const d = r.direction;
    const b = this.buildings;
    let t = 0;
    let prevT = 0;
    const maxT = 150000;
    let building = -1;
    for (let iter = 0; iter < 4000 && t < maxT; iter++) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      const g = this.heightAt(x, z);
      const above = y - g;
      if (above <= 0) {
        // Refine between the last two samples.
        let a = prevT;
        let c = t;
        for (let k = 0; k < 24; k++) {
          const m = (a + c) / 2;
          const yy = o.y + d.y * m;
          const gg = this.heightAt(o.x + d.x * m, o.z + d.z * m);
          if (yy - gg > 0) a = m;
          else c = m;
        }
        const tt = (a + c) / 2;
        const hx = o.x + d.x * tt;
        const hz = o.z + d.z * tt;
        return { x: hx, y: this.heightAt(hx, hz), z: hz, t: tt, building };
      }
      // Close to the ground: check buildings at this point.
      if (b && above < 160 && building < 0) {
        b.forEachNear(x, z, 45, (i) => {
          if (building >= 0) return;
          const top = b.base[i] + b.height(i) + (b.roof[i] ? 3 : 0);
          if (y <= top && y >= b.base[i] - 1 && b.contains(i, x, z)) building = i;
        });
        if (building >= 0) return { x, y, z, t, building };
      }
      prevT = t;
      // Big steps far above the ground, small ones near it.
      t += Math.max(1.5, Math.min(above * 0.5, 400));
    }
    return null;
  }

  /** Nearest vehicle to a screen point within `radius` px. */
  vehicle(clientX, clientY, world, radius = 14) {
    const rect = this.dom.getBoundingClientRect();
    const cam = this.camera;
    const p = this.pose;
    let best = null;
    let bestD = radius;
    for (const veh of world.vehicles) {
      world.pose(veh, p);
      this.v.set(p.x, p.y + 1, p.z).project(cam);
      if (this.v.z > 1 || this.v.z < -1) continue;
      const sx = rect.left + (this.v.x * 0.5 + 0.5) * rect.width;
      const sy = rect.top + (-this.v.y * 0.5 + 0.5) * rect.height;
      const dd = Math.hypot(sx - clientX, sy - clientY);
      if (dd < bestD) {
        bestD = dd;
        best = veh;
      }
    }
    return best;
  }
}

// Camera modes: free orbit over the terrain, a top-down map view, a slow aerial tour, a chase
// camera that follows a vehicle, and a driver's-eye view. The camera never dips into a
// mountainside, and the near plane follows height so close-ups stay crisp.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp } from '../sim/constants.js';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export class CameraRig {
  constructor(camera, dom, heightAt) {
    this.camera = camera;
    this.dom = dom;
    this.heightAt = heightAt;
    const c = new OrbitControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.maxPolarAngle = Math.PI * 0.48;
    c.minDistance = 12;
    c.maxDistance = 95000;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 1.15;
    c.panSpeed = 1.0;
    c.keys = {};
    this.controls = c;
    this.mode = 'orbit';
    this.vehicle = null;
    this.flight = null;
    this.tourT = 0;
    this.focus = new THREE.Vector3();
    this.bounds = { x0: -40000, x1: 40000, z0: -35000, z1: 30000 };
    this.keys = new Set();
    this.onModeChange = () => {};
    this._pose = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 };
    this._last = new THREE.Vector3();
    this._dir = new THREE.Vector3(1, 0, 0);
    this.buildings = null;

    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'q', 'e', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'r', 'f'].includes(k)) {
        this.keys.add(k);
        if (k.startsWith('arrow')) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    c.addEventListener('start', () => {
      this.flight = null;
      if (this.mode === 'tour') this.setMode('orbit');
    });
  }

  setBounds(b) {
    this.bounds = b;
  }

  setMode(mode, vehicle = null) {
    if (this.vehicle && this.vehicle !== vehicle) this.vehicle.pinned = false;
    const was = this.mode;
    this.mode = mode;
    this.vehicle = vehicle;
    if (vehicle) vehicle.pinned = true;
    const c = this.controls;
    c.enabled = mode !== 'drive';
    if (mode === 'top') {
      c.minPolarAngle = 0;
      c.maxPolarAngle = 0.0001;
      c.screenSpacePanning = true;
      c.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
      c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    } else if (was === 'top' || mode === 'orbit') {
      c.minPolarAngle = 0;
      c.maxPolarAngle = Math.PI * 0.48;
      c.screenSpacePanning = false;
      c.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
      c.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    }
    this.onModeChange(mode, vehicle);
  }

  get distance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  get heightAboveGround() {
    const p = this.camera.position;
    return p.y - this.heightAt(p.x, p.z);
  }

  /** Opening shot: downtown from the south, Mount Pisgah behind, the Blue Ridge to the east. */
  home(instant = true) {
    const target = new THREE.Vector3(600, this.heightAt(600, 2000), 2000);
    const pos = new THREE.Vector3(5200, target.y + 3400, 12500);
    this.setMode('orbit');
    if (instant) {
      this.controls.target.copy(target);
      this.camera.position.copy(pos);
      this.controls.update();
    } else {
      this.flyTo(target, pos);
    }
  }

  flyTo(target, position, duration = 1.8) {
    this.flight = {
      t: 0, duration,
      fromT: this.controls.target.clone(), toT: target.clone(),
      fromP: this.camera.position.clone(), toP: position.clone(),
    };
  }

  /** Look at ground point (x, z) from about `dist` meters, keeping the current viewing direction. */
  lookAt(x, z, dist = 1800, pitch = null) {
    const target = new THREE.Vector3(x, this.heightAt(x, z), z);
    let dir = this.camera.position.clone().sub(this.controls.target).normalize();
    if (this.mode === 'top') dir = new THREE.Vector3(0, 1, 0.0001);
    else {
      if (pitch !== null) {
        const flat = Math.hypot(dir.x, dir.z) || 1;
        const s = Math.sin(pitch);
        const k = Math.cos(pitch) / flat;
        dir.set(dir.x * k, s, dir.z * k);
      } else if (dir.y < 0.3) {
        dir.y = 0.3;
      }
      dir.normalize();
    }
    if (this.mode !== 'top' && this.mode !== 'orbit') this.setMode('orbit');
    this.flyTo(target, target.clone().addScaledVector(dir, dist));
  }

  /** Switch between the 3D orbit and the top-down map view, keeping the same spot in view. */
  toggleTop(on = this.mode !== 'top') {
    const t = this.controls.target.clone();
    const d = this.distance;
    if (on) {
      this.setMode('top');
      this.flyTo(t, new THREE.Vector3(t.x, t.y + Math.max(d, 1500), t.z + 0.01), 1.2);
    } else {
      this.setMode('orbit');
      const pos = new THREE.Vector3(t.x, t.y + d * 0.55, t.z + d * 0.83);
      this.flyTo(t, pos, 1.2);
    }
  }

  tour(center) {
    this.setMode('tour');
    this.tourCenter = center || new THREE.Vector3(0, this.heightAt(0, 0), 0);
    const off = this.camera.position.clone().sub(this.controls.target);
    this.tourT = Math.atan2(off.z, off.x);
  }

  follow(v, world) {
    this.setMode('follow', v);
    world.pose(v, this._pose);
    const p = new THREE.Vector3(this._pose.x, this._pose.y + 1.5, this._pose.z);
    this._last.copy(p);
    const back = new THREE.Vector3(-this._pose.dx, 0, -this._pose.dz).normalize();
    this.flyTo(p, p.clone().addScaledVector(back, 34).add(new THREE.Vector3(0, 15, 0)), 1.2);
  }

  drive(v) {
    this.setMode('drive', v);
    this.flight = null;
  }

  release() {
    this.setMode('orbit');
  }

  update(dt, world) {
    const c = this.controls;
    const cam = this.camera;
    if (this.vehicle && (this.vehicle.dead || !world || !world.vehicles.includes(this.vehicle))) this.setMode('orbit');

    if (this.mode === 'tour' && this.tourCenter) {
      this.tourT += dt * 0.035;
      const t = this.tourT;
      const r = 3200 + Math.sin(t * 1.7) * 900;
      const h = 900 + Math.sin(t * 1.3 + 1) * 400;
      const tx = this.tourCenter.x + Math.sin(t * 0.9) * 600;
      const tz = this.tourCenter.z + Math.cos(t * 0.7) * 600;
      const ty = this.heightAt(tx, tz);
      c.target.lerp(new THREE.Vector3(tx, ty, tz), 1 - Math.exp(-dt * 0.8));
      const gx = tx + Math.cos(t) * r;
      const gz = tz + Math.sin(t) * r;
      const goal = new THREE.Vector3(gx, Math.max(ty, this.heightAt(gx, gz)) + h, gz);
      cam.position.lerp(goal, 1 - Math.exp(-dt * 0.8));
    }

    if ((this.mode === 'follow' || this.mode === 'drive') && this.vehicle) {
      world.pose(this.vehicle, this._pose);
      const p = new THREE.Vector3(this._pose.x, this._pose.y + 1.5, this._pose.z);
      if (this.mode === 'follow') {
        const delta = p.clone().sub(this._last);
        if (!this.flight) {
          cam.position.add(delta);
          c.target.add(delta);
          c.target.lerp(p, 1 - Math.exp(-dt * 3));
        } else {
          this.flight.toT.add(delta);
          this.flight.toP.add(delta);
        }
      } else {
        this._dir.lerp(new THREE.Vector3(this._pose.dx, this._pose.dy, this._pose.dz), 1 - Math.exp(-dt * 6)).normalize();
        const type = this.vehicle.type;
        const eye = type === 'bus' || type === 'schoolbus' || type === 'semi' || type === 'engine' ? 2.6 : type === 'truck' || type === 'ambulance' ? 2.4 : type === 'van' ? 1.9 : 1.25;
        const fwd = this.vehicle.len * 0.08;
        const sx = -this._dir.z;
        const sz = this._dir.x;
        const sl = Math.hypot(sx, sz) || 1;
        cam.position.set(p.x + this._dir.x * fwd - (sx / sl) * 0.35, this._pose.y + eye, p.z + this._dir.z * fwd - (sz / sl) * 0.35);
        c.target.set(cam.position.x + this._dir.x * 40, cam.position.y + this._dir.y * 40 - 1.5, cam.position.z + this._dir.z * 40);
        cam.lookAt(c.target);
      }
      this._last.copy(p);
    }

    if (this.flight) {
      const f = this.flight;
      f.t += dt / f.duration;
      const k = ease(Math.min(1, f.t));
      c.target.lerpVectors(f.fromT, f.toT, k);
      cam.position.lerpVectors(f.fromP, f.toP, k);
      // Arc up over ridges on long flights.
      const span = f.fromP.distanceTo(f.toP);
      cam.position.y += Math.sin(k * Math.PI) * Math.min(4000, span * 0.25);
      if (f.t >= 1) this.flight = null;
    }

    // Keyboard: WASD / arrows pan, Q and E orbit, R and F zoom.
    if (this.keys.size && this.mode !== 'drive') {
      const dist = this.distance;
      const fwd = new THREE.Vector3().subVectors(c.target, cam.position);
      if (this.mode === 'top') fwd.set(0, 0, -1);
      fwd.y = 0;
      fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const move = new THREE.Vector3();
      const sp = dist * 0.9 * dt;
      if (this.keys.has('w') || this.keys.has('arrowup')) move.addScaledVector(fwd, sp);
      if (this.keys.has('s') || this.keys.has('arrowdown')) move.addScaledVector(fwd, -sp);
      if (this.keys.has('a') || this.keys.has('arrowleft')) move.addScaledVector(right, -sp);
      if (this.keys.has('d') || this.keys.has('arrowright')) move.addScaledVector(right, sp);
      if (move.lengthSq() > 0) {
        if (this.mode !== 'orbit' && this.mode !== 'top') this.setMode('orbit');
        c.target.add(move);
        cam.position.add(move);
      }
      const rot = (this.keys.has('q') ? 1 : 0) - (this.keys.has('e') ? 1 : 0);
      if (rot && this.mode !== 'top') {
        const off = cam.position.clone().sub(c.target);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * dt * 0.9);
        cam.position.copy(c.target).add(off);
      }
      const zoom = (this.keys.has('f') ? 1 : 0) - (this.keys.has('r') ? 1 : 0);
      if (zoom) {
        const off = cam.position.clone().sub(c.target);
        off.multiplyScalar(1 + zoom * dt * 1.2);
        if (off.length() > c.minDistance && off.length() < c.maxDistance) cam.position.copy(c.target).add(off);
      }
    }

    if (this.mode === 'orbit' || this.mode === 'top') {
      const b = this.bounds;
      const tx = clamp(c.target.x, b.x0, b.x1);
      const tz = clamp(c.target.z, b.z0, b.z1);
      if (tx !== c.target.x || tz !== c.target.z) {
        cam.position.x += tx - c.target.x;
        cam.position.z += tz - c.target.z;
        c.target.x = tx;
        c.target.z = tz;
      }
      // Keep the orbit target on the ground as it pans across the valleys and ridges.
      if (!this.flight) {
        const g = this.heightAt(c.target.x, c.target.z);
        const dy = (g - c.target.y) * (1 - Math.exp(-dt * 6));
        c.target.y += dy;
        cam.position.y += dy;
      }
    }
    if (this.mode !== 'drive') c.update();

    // Never inside the mountain, never inside a building.
    const ground = this.heightAt(cam.position.x, cam.position.z);
    const minClear = this.mode === 'drive' ? 0.8 : 6;
    if (cam.position.y < ground + minClear) cam.position.y = ground + minClear;
    if (this.buildings && this.mode !== 'drive' && cam.position.y - ground < 120) {
      const b = this.buildings;
      const p = cam.position;
      b.forEachNear(p.x, p.z, 60, (i) => {
        const top = b.base[i] + b.height(i) + 3;
        if (p.y < top && b.contains(i, p.x, p.z)) p.y = top;
      });
    }

    const agl = Math.max(1, cam.position.y - ground);
    const near = this.mode === 'drive' ? 0.2 : clamp(Math.min(this.distance, agl) * 0.01, 0.3, 60);
    if (Math.abs(cam.near - near) > near * 0.1) {
      cam.near = near;
      cam.updateProjectionMatrix();
    }
    this.focus.copy(c.target);
  }
}

// Ask Asheville: loads the county, builds the 3D scene, runs the traffic simulation and wires up
// the tools (questions and answers, map layers, drive times, emergency response, places).

import * as THREE from 'three';
import { Stage, QUALITY } from './render/stage.js';
import { CameraRig } from './render/cameraRig.js';
import { Atmosphere } from './render/atmosphere.js';
import { TerrainView } from './render/terrain.js';
import { RoadView } from './render/roads.js';
import { BuildingView } from './render/buildings.js';
import { buildWater } from './render/water.js';
import { MarkerLayer, LabelLayer } from './render/markers.js';
import { RouteLayer } from './render/routes.js';
import { VehicleView } from './render/vehicles.js';
import { TreeLayer } from './render/trees.js';
import { Overlays } from './render/overlays.js';
import { Picker } from './render/picker.js';
import { Rain } from './render/effects.js';
import { shared } from './render/materials.js';
import { loadWorldData, loadAddresses, KIND, RESIDENTIAL_KINDS } from './data/worldData.js';
import { loadJSON } from './data/bundle.js';
import { Router } from './sim/router.js';
import { smoothstep } from './sim/constants.js';
import { Hud, loadPrefs, savePrefs } from './ui/hud.js';
import { LabUI } from './lab/ui.js';

// Yield a frame so the loader can repaint; a timer covers hidden tabs where frames pause.
const CATCH_UP_MIN = 20;
const nextFrame = () => new Promise((resolve) => {
  let done = false;
  const finish = () => {
    if (!done) {
      done = true;
      resolve();
    }
  };
  requestAnimationFrame(finish);
  setTimeout(finish, 80);
});
const BASE = './data/';
// Reference origins for the live drive-time board (to the current destination).
const BOARD = [
  { label: 'Downtown (Pack Square)', x: 0, z: 0 },
  { label: 'West Asheville', x: -4300, z: 1100 },
  { label: 'North Asheville', x: -900, z: -4600 },
  { label: 'South Asheville', x: 2300, z: 9500 },
  { label: 'Weaverville', x: -1100, z: -11200 },
  { label: 'Black Mountain', x: 20900, z: -2500 },
];

/** School laptops and tablets: fewer cores or little memory. */
function modestDevice() {
  return (navigator.hardwareConcurrency || 8) <= 4 || (navigator.deviceMemory || 8) <= 4;
}

function defaultQuality() {
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return small || coarse || modestDevice() ? 'medium' : 'high';
}

class App {
  constructor() {
    this.prefs = { quality: defaultQuality(), sample: modestDevice() ? 0.6 : 1, speed: 30, ...loadPrefs() };
    if (!QUALITY[this.prefs.quality]) this.prefs.quality = defaultQuality();
    this.stage = new Stage(document.getElementById('viewport'));
    this.stage.setQuality(this.prefs.quality);
    this.atmos = new Atmosphere(this.stage.renderer, this.stage.scene);
    this.atmos.setShadowQuality(QUALITY[this.prefs.quality].shadowSize, QUALITY[this.prefs.quality].shadows);
    this.hud = new Hud(this);
    this.speed = this.prefs.speed || 30;
    this.paused = false;
    this.selection = null;
    this.tool = null; // {kind: 'call', type} | {kind: 'station', station} | {kind: 'drive-from'}
    this.extraStations = [];
    this.perf = { time: 0, frames: 0, warmup: 8, checked: false };
    this._sun = [0, 1, 0];
    this._moon = [0, -1, 0];
    this.last = performance.now();
    this.frame = this.frame.bind(this);
  }

  async start() {
    const hud = this.hud;
    hud.showLoader('Surveying the county', 0.02);
    const progress = { roads: 0, buildings: 0, terrain: 0 };
    const data = await loadWorldData(BASE, {
      onProgress: (label, f) => {
        const k = label.includes('road') ? 'roads' : label.includes('building') ? 'buildings' : 'terrain';
        progress[k] = f;
        hud.showLoader(label, 0.05 + 0.45 * ((progress.roads + progress.buildings + progress.terrain) / 3));
      },
    });
    this.data = data;
    this.net = data.roads;
    this.router = new Router(this.net);
    this.facts = await loadJSON(BASE + 'facts.json').catch(() => null);
    hud.showLoader('Shaping the mountains', 0.55);
    await nextFrame();
    const scene = this.stage.scene;
    this.terrain = new TerrainView(data.terrain, data.areas);
    scene.add(this.terrain.group);
    const heightAt = (x, z) => this.terrain.heightAt(x, z);
    this.heightAt = heightAt;
    this.net.setHeights(heightAt, 0);
    hud.showLoader('Paving 7,600 km of road', 0.65);
    await nextFrame();
    this.roads = new RoadView(this.net);
    scene.add(this.roads.group);
    if (data.water) {
      this.water = buildWater(data.water, heightAt);
      scene.add(this.water.group);
    }
    hud.showLoader('Raising 185,000 buildings', 0.75);
    await nextFrame();
    this.buildings = new BuildingView(data.buildings, heightAt);
    scene.add(this.buildings.group);
    // Ground heights for every building now (the meshes fill in progressively).
    const b = data.buildings;
    for (let i = 0; i < b.count; i++) b.base[i] = heightAt(b.x[i], b.z[i]);
    this.trees = new TreeLayer(data, this.terrain, this.prefs.quality === 'low' ? 25000 : 60000);
    for (const m of [this.trees.dec, this.trees.eve]) m.castShadow = this.prefs.quality === 'high';
    scene.add(this.trees.group);
    this.markers = new MarkerLayer(data.pois, heightAt);
    scene.add(this.markers.group);
    this.dest = this.restoreDestination();
    this.markers.setDestination(this.dest);
    this.routes = new RouteLayer(this.net, heightAt);
    scene.add(this.routes.group);
    this.vehicles = new VehicleView(QUALITY[this.prefs.quality].vehicleDetail, 70000);
    scene.add(this.vehicles.group);
    this.rain = new Rain();
    this.rain.groundAt = heightAt;
    scene.add(this.rain.lines);
    this.overlays = new Overlays(data, this.terrain, this.roads, this.buildings);
    await this.overlays.init(BASE);
    this.labels = new LabelLayer(document.body);
    this.setupLabels();

    hud.showLoader('Filling the roads', 0.85);
    await nextFrame();
    this.world = await this.createWorld(data);
    this.rig = new CameraRig(this.stage.camera, this.stage.renderer.domElement, heightAt);
    this.rig.buildings = data.buildings;
    const nb = this.net.bounds;
    this.rig.setBounds({ x0: nb.x0 - 3000, x1: nb.x1 + 3000, z0: nb.z0 - 3000, z1: nb.z1 + 3000 });
    this.rig.onModeChange = () => this.syncControls();
    this.rig.home();
    this.picker = new Picker(this.stage.camera, this.stage.renderer.domElement, heightAt, data.buildings);
    this.buildings.start(this.rig.focus.x, this.rig.focus.z);
    this.buildings.buildSome(400);
    this.stage.onResize.push((w, h, pr) => this.vehicles.setViewport(h, pr, this.stage.camera.fov));
    this.vehicles.setViewport(this.stage.container.clientHeight, this.stage.pixelRatio, this.stage.camera.fov);
    this.boardNodes = BOARD.map((p) => ({ ...p, node: this.net.nearestNode(p.x, p.z, (i) => this.net.nodeRank[i] >= 2) }));
    this.bindPointer();
    hud.init();
    this.syncControls();
    hud.showLoader('Getting ready for questions', 0.95);
    this.labUI = new LabUI(this);
    await this.labUI.init().catch((err) => console.error('The question tools failed to start.', err));
    this.atmos.update(this.sunDir(), this.moonDir(), this.world.weather, this.rig.focus, this.rig.distance, 1, 500);
    this.stage.renderer.compile(scene, this.stage.camera);
    hud.hideLoader();
    if (document.getElementById('welcome').hidden && !location.hash) setTimeout(() => hud.firstTip(), 2500);
    window.asheville = this;
    requestAnimationFrame(this.frame);
  }

  /** The traffic simulation, or a still map if it can't start (or with ?nosim). */
  async createWorld(data) {
    const params = new URLSearchParams(location.search);
    if (!params.has('nosim')) {
      try {
        const { World } = await import('./sim/world.js');
        // Every visit opens on an ordinary school day, whatever was tried last time.
        const w = new World(data, { seed: 2026, scenario: params.get('scenario') || undefined, sample: this.prefs.sample ?? 1, startHour: Number(params.get('hour')) || 7.25 });
        if (w.ready) await w.ready;
        // Typical-day congestion (recorded simulated days) for the 8 AM / 5:30 PM drive times.
        await Promise.all([w.loadTypical('weekday'), w.loadTypical('saturday')]);
        // A school day opens at 8 a.m.: daylight and the morning rush.
        this.startCatchUp(w, Number(params.get('hour')) || (w.scenario && w.scenario.id === 'weekday' ? 8 : null));
        return w;
      } catch (err) {
        console.error('Simulation failed to start; showing the map only.', err);
        this.hud.toast('The traffic simulation could not start; showing the map only.', 6000);
      }
    }
    return new StillWorld(data, this.router, Number(params.get('hour')) || 7.25);
  }

  setupLabels() {
    const items = [];
    for (const p of this.data.pois) {
      if (p.kind === 'place') {
        const style = p.sub === 'city' ? 'city' : p.sub === 'town' ? 'town' : p.sub === 'village' ? 'town' : 'hood';
        items.push({
          text: p.name, x: p.x, z: p.z, y: this.heightAt(p.x, p.z), lift: 40, style,
          priority: p.rank * 10, minHeight: style === 'hood' ? 250 : 0, maxHeight: style === 'hood' ? 9000 : style === 'town' ? 60000 : Infinity,
        });
      }
    }
    for (const p of this.data.pois) {
      if (p.kind === 'venue' && ['stadium', 'music', 'arena', 'attraction'].includes(p.sub)) {
        items.push({ text: p.name.replace(/ \(.*\)$/, ''), x: p.x, z: p.z, y: this.heightAt(p.x, p.z), lift: 60, style: 'poi', priority: 30, maxHeight: 7000 });
      }
      if (p.kind === 'hospital' && p.sub === 'ed') {
        items.push({ text: p.name.split(' (')[0], x: p.x, z: p.z, y: this.heightAt(p.x, p.z), lift: 60, style: 'poi', priority: 40, maxHeight: 14000 });
      }
    }
    // Highway names, a few well-separated points along each route.
    const net = this.net;
    const ROUTES = [['I 26', 'I-26'], ['I 40', 'I-40'], ['I 240', 'I-240'], ['US 19', 'US 19/23'], ['US 25', 'US 25'], ['US 70', 'US 70'],
      ['US 74A', 'US 74A'], ['NC 191', 'NC 191'], ['NC 251', 'NC 251'], ['NC 63', 'NC 63'], ['Blue Ridge Parkway', 'Blue Ridge Pkwy']];
    const p = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 };
    for (const [match, text] of ROUTES) {
      const placed = [];
      const edges = [];
      for (let e = 0; e < net.edgeCount; e++) {
        const nm = net.names[net.nameId[e]];
        if (nm && nm.includes(match) && net.len[e] > 300 && net.dir[e] > 0) edges.push(e);
      }
      edges.sort((a, c) => net.len[c] - net.len[a]);
      for (const e of edges) {
        net.pointAt(e, net.len[e] / 2, p);
        if (placed.some((q) => Math.hypot(q[0] - p.x, q[1] - p.z) < 7000)) continue;
        placed.push([p.x, p.z]);
        items.push({ text, x: p.x, z: p.z, y: p.y, lift: 10, style: 'road', priority: 20, minHeight: 600, maxHeight: 45000 });
        if (placed.length >= 5) break;
      }
    }
    this._labelItems = items;
    this.refreshDestLabel();
  }

  refreshDestLabel() {
    const d = this.dest;
    const extra = d ? [{ text: d.name.replace(/ \(.*\)$/, ''), x: d.x, z: d.z, y: this.heightAt(d.x, d.z), lift: 120, style: 'dest', priority: 100 }] : [];
    this.labels.set([...(this._labelItems || []), ...extra]);
  }

  // --- Destination (the place drive times are measured to) ---------------------------------------------

  /** The saved destination, or downtown Asheville. */
  restoreDestination() {
    const saved = this.prefs.dest;
    const focus = this.data.focus;
    if (!saved) return focus;
    const poi = this.data.pois.find((p) => p.name === saved.name && Math.hypot(p.x - saved.x, p.z - saved.z) < 50);
    return poi || this.placeAt(saved.x, saved.z, saved.name);
  }

  /** A destination at any point (snapped to the nearest road). */
  placeAt(x, z, name) {
    const node = this.net.nearestNode(x, z, (i) => this.net.nodeRank[i] >= 1);
    return { kind: 'place', sub: 'destination', name: name || 'Chosen spot', x, z, node };
  }

  setDestination(d) {
    if (!d) d = this.data.focus;
    if (d.node === undefined || d.node < 0) d = this.placeAt(d.x, d.z, d.name);
    this.dest = d;
    this.prefs.dest = d === this.data.focus ? null : { name: d.name, x: d.x, z: d.z };
    savePrefs(this.prefs);
    this._destCache = null;
    this._freeToDest = null;
    this.markers.setDestination(d);
    this.refreshDestLabel();
    this.hud.onDestinationChange();
  }

  sunDir() {
    const c = this.world ? this.world.clock : null;
    if (c && c.sunDirection) return c.sunDirection(this._sun);
    return this._sun;
  }

  moonDir() {
    const c = this.world ? this.world.clock : null;
    if (c && c.moonDirection) return c.moonDirection(this._moon);
    return this._moon;
  }

  // --- Weights and drive-time queries ----------------------------------------------------------------

  weights(basis) {
    const w = this.world;
    if (basis === 'live') return w.liveWeights();
    if (basis === 'am') return w.typicalWeights ? w.typicalWeights(8, 'weekday') : this.net.ffTime;
    if (basis === 'pm') return w.typicalWeights ? w.typicalWeights(17.5, 'weekday') : this.net.ffTime;
    return this.net.ffTime;
  }

  /** Seconds from every node to `node` (reverse search). */
  timesTo(node, basis = 'free', maxTime = Infinity) {
    return this.router.dijkstra([node], this.weights(basis), { reverse: true, maxTime });
  }

  timesFrom(node, basis = 'free', maxTime = Infinity) {
    return this.router.dijkstra([node], this.weights(basis), { maxTime });
  }

  /** Extra time to get from a building to its road node (driveway, parking). */
  accessSeconds(i) {
    return 20 + this.data.buildings.snapDm[i] / 10 / 6;
  }

  /** Drive times from building i to the destination: free flow, typical 8 am, live now. */
  destDrive(i) {
    const d = this.dest;
    if (!d) return null;
    const t = Math.floor(performance.now() / 4000);
    if (!this._destCache || this._destCache.t !== t || this._destCache.node !== d.node) {
      this._destCache = { t, node: d.node, free: this.timesTo(d.node, 'free'), am: this.timesTo(d.node, 'am'), live: this.timesTo(d.node, 'live') };
    }
    const n = this.data.buildings.node[i];
    const acc = this.accessSeconds(i);
    const c = this._destCache;
    return { free: c.free[n] + acc, am: c.am[n] + acc, live: c.live[n] + acc };
  }

  /** Zoned public schools for a census block (from the county's attendance districts, via the demand model). */
  zonedSchools(block) {
    const d = this.data.demand;
    if (!this._schByBlock) {
      this._schByBlock = new Map();
      for (let k = 0; k < d.schBlock.length; k++) {
        const b = d.schBlock[k];
        if (!this._schByBlock.has(b)) this._schByBlock.set(b, []);
        this._schByBlock.get(b).push([d.schSchool[k], d.schCount[k]]);
      }
    }
    const list = this._schByBlock.get(block) || [];
    const best = {};
    for (const [si, c] of list) {
      const s = d.schools[si];
      if (s.kind !== 'public') continue;
      const lo = s.lo ?? 0;
      const level = lo >= 9 ? 'High' : lo >= 7 ? 'Middle' : lo >= 5 ? (s.hi <= 6 ? 'Intermediate' : 'Middle') : 'Elementary';
      if (!best[level] || c > best[level][1]) best[level] = [s, c];
    }
    return ['Elementary', 'Intermediate', 'Middle', 'High'].filter((l) => best[l]).map((l) => ({ level: l, school: best[l][0] }));
  }

  routeEdges(fromNode, toNode, basis = 'live') {
    return this.router.route(fromNode, toNode, this.weights(basis));
  }

  /** Live drive time board: a few places around the county to the destination. */
  boardTimes() {
    const d = this.dest;
    if (!d) return [];
    const live = this.router.dijkstra([d.node], this.weights('live'), { reverse: true });
    const free = this._freeToDest || (this._freeToDest = this.timesTo(d.node, 'free'));
    return this.boardNodes.filter((b) => Math.hypot(b.x - d.x, b.z - d.z) > 1500)
      .map((b) => ({ label: b.label, live: live[b.node], free: free[b.node] }));
  }

  // --- Drive-time maps ------------------------------------------------------------------------------------

  showDriveMap(target, opts = {}) {
    const basis = opts.basis || 'free';
    const node = target.node;
    const times = opts.from ? this.timesFrom(node, basis) : this.timesTo(node, basis);
    this.driveMap = { target, basis, times, ...opts };
    this.overlays.showHeat(times, { maxMinutes: opts.maxMinutes ?? 45, bandMinutes: opts.bandMinutes ?? 5, onRoads: true });
    this.hud.renderLegend();
    return times;
  }

  clearDriveMap() {
    this.driveMap = null;
    this.coverage = null;
    this.overlays.clearHeat();
    this.routes.clear('iso');
    this.hud.renderLegend();
  }

  /** Residents, school-age children and homes within each time band of a times array. */
  reachStats(times, bands = [10, 15, 20, 30, 45]) {
    const b = this.data.buildings;
    const out = bands.map((m) => ({ minutes: m, residents: 0, kids: 0, homes: 0 }));
    let total = 0;
    for (let i = 0; i < b.count; i++) {
      const r = b.residents[i];
      if (!r && !b.units[i]) continue;
      total += r;
      const t = (times[b.node[i]] + this.accessSeconds(i)) / 60;
      for (const o of out) {
        if (t <= o.minutes) {
          o.residents += r;
          o.kids += b.kids10[i] / 10;
          o.homes += b.units[i];
        }
      }
    }
    return { bands: out, total };
  }

  // --- Emergency ----------------------------------------------------------------------------------------------

  showCoverage(kind, basis = 'free') {
    const em = this.world.emergency;
    const times = em.responseTimes(kind, { live: basis === 'live', extra: this.extraStations.filter((s) => s.kind === kind || kind === 'medical') });
    this.coverage = { kind, basis, times };
    this.overlays.showHeat(times, { maxMinutes: 20, bandMinutes: 2, onRoads: true, opacity: 0.66 });
    this.hud.renderLegend();
    return times;
  }

  coverageStats(times, thresholds = [240, 480, 539, 720]) {
    const b = this.data.buildings;
    let total = 0;
    const within = thresholds.map(() => 0);
    for (let i = 0; i < b.count; i++) {
      const r = b.residents[i];
      if (!r) continue;
      total += r;
      const t = times[b.node[i]] + this.accessSeconds(i) * 0.5;
      thresholds.forEach((th, k) => {
        if (t <= th) within[k] += r;
      });
    }
    return { total, within: thresholds.map((th, k) => ({ seconds: th, residents: within[k], share: total ? within[k] / total : 0 })) };
  }

  call911(type, x, z) {
    const inc = this.world.emergency.call({ type, x, z });
    if (!inc) {
      this.hud.toast('No unit could reach that spot by road.');
      return null;
    }
    this.hud.toast(`911: ${inc.label || type} call. Units dispatched.`);
    this.refreshIncidentMarkers();
    this.hud.renderPanel();
    return inc;
  }

  refreshIncidentMarkers() {
    const extra = [];
    for (const inc of this.world.emergency.incidents) {
      if (inc.status === 'closed') continue;
      extra.push({ kind: 'incident', icon: 'incident', name: inc.label || `${inc.type} call`, x: inc.x, z: inc.z, incident: inc });
    }
    for (const s of this.extraStations) extra.push({ ...s, icon: 'station_new' });
    this.markers.setExtra(extra);
  }

  addStation(kind, x, z) {
    const node = this.net.nearestNode(x, z, (i) => this.net.nodeRank[i] >= 2);
    const label = { fire: 'New fire station', ems: 'New ambulance base', police: 'New police post' }[kind] || 'New station';
    const s = { kind, name: label, x, z, node, hypothetical: true };
    this.extraStations.push(s);
    this.refreshIncidentMarkers();
    if (this.coverage) this.showCoverage(this.coverage.kind, this.coverage.basis);
    this.hud.renderPanel();
    return s;
  }

  // --- Selection -------------------------------------------------------------------------------------------------

  bindPointer() {
    const dom = this.stage.renderer.domElement;
    let down = null;
    // Hover readout for data layers and drive-time maps.
    let hoverAt = 0;
    dom.addEventListener('pointermove', (e) => {
      if (e.buttons || (!this.overlays.metric && !this.overlays.heat)) {
        this.hud.hover(null);
        return;
      }
      const now = performance.now();
      if (now - hoverAt < 90) return;
      hoverAt = now;
      const g = this.picker.ground(e.clientX, e.clientY);
      this.hud.hover(g ? { ...g, cx: e.clientX, cy: e.clientY } : null);
    });
    dom.addEventListener('pointerleave', () => this.hud.hover(null));
    dom.addEventListener('pointerdown', (e) => {
      down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    dom.addEventListener('pointerup', (e) => {
      if (!down || !this.world) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 6 && performance.now() - down.t < 600) this.click(e.clientX, e.clientY);
      down = null;
    });
  }

  click(cx, cy) {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    // Tools take the click first.
    if (this.tool) {
      const g = this.picker.ground(cx, cy);
      if (!g) return;
      const t = this.tool;
      if (t.kind === 'call') {
        const inc = this.call911(t.type, g.x, g.z);
        if (inc) this.select({ kind: 'incident', incident: inc });
      } else if (t.kind === 'station') {
        this.addStation(t.station, g.x, g.z);
      } else if (t.kind === 'set-dest') {
        const marker = this.markers.pick(cx, cy, this.stage.camera, rect);
        if (marker && !marker.incident && marker.kind) this.setDestination(marker);
        else this.setDestination(this.placeAt(g.x, g.z, g.building >= 0 ? this.hud.addressOf(g.building) || 'Chosen building' : 'Chosen spot'));
      } else if (t.kind === 'drive-target') {
        const node = this.net.nearestNode(g.x, g.z, (i) => this.net.nodeRank[i] >= 1);
        this.showDriveMap({ node, x: g.x, z: g.z, name: 'Chosen spot' }, { basis: this.hud.driveBasis });
      }
      if (!t.sticky) this.setTool(null);
      return;
    }
    const marker = this.markers.pick(cx, cy, this.stage.camera, rect);
    if (marker) {
      if (marker.incident) this.select({ kind: 'incident', incident: marker.incident });
      else this.select({ kind: 'poi', poi: marker });
      return;
    }
    const veh = this.picker.vehicle(cx, cy, this.world, 12);
    const g = this.picker.ground(cx, cy);
    if (veh) {
      this.select({ kind: 'vehicle', vehicle: veh });
      return;
    }
    if (!g) {
      this.select(null);
      return;
    }
    if (g.building >= 0) {
      this.select({ kind: 'building', building: g.building });
      return;
    }
    const bi = this.data.buildings.pick(g.x, g.z, 6);
    if (bi >= 0 && this.data.buildings.contains(bi, g.x, g.z)) {
      this.select({ kind: 'building', building: bi });
      return;
    }
    const seg = this.net.nearestSegment(g.x, g.z, 14);
    if (seg) {
      this.select({ kind: 'road', geom: seg.geom, x: g.x, z: g.z });
      return;
    }
    this.select({ kind: 'ground', x: g.x, z: g.z });
  }

  setTool(tool) {
    this.tool = tool;
    this.hud.renderToolHint();
    this.stage.renderer.domElement.style.cursor = tool ? 'crosshair' : '';
  }

  select(hit) {
    if (this.selection && this.selection.kind === 'vehicle' && this.selection.vehicle !== this.rig.vehicle) this.selection.vehicle.pinned = false;
    this.selection = hit;
    if (hit && hit.kind === 'vehicle') hit.vehicle.pinned = true;
    this.buildings.select(hit && hit.kind === 'building' ? hit.building : -1);
    this.markers.select(hit && hit.kind === 'poi' ? hit.poi : null);
    if (!hit || hit.kind !== 'building') this.routes.remove('sel-route');
    this.hud.select(hit);
  }

  /** Draw the route from a building to the destination. */
  routeToDest(i, basis = 'live') {
    const r = this.routeEdges(this.data.buildings.node[i], this.dest.node, basis);
    if (!r) return null;
    this.routes.setRoute('sel-route', r.edges, '#ffc93c', { width: 9, minPx: 5 });
    return r;
  }

  routeBetween(fromNode, toNode, id = 'sel-route', color = '#ffc93c', basis = 'live') {
    const r = this.routeEdges(fromNode, toNode, basis);
    if (r) this.routes.setRoute(id, r.edges, color, { width: 9, minPx: 5 });
    return r;
  }

  /** Fly to a ground point. The view is nudged so the point lands in the part of the map no panel covers. */
  flyTo(x, z, dist = 1600, pitch = null) {
    const [ox, oz] = this.labUI && this.labUI.view ? this.labUI.view.offset(dist) : [0, 0];
    this.rig.lookAt(x + ox, z + oz, dist, pitch);
  }

  frameSelection() {
    const s = this.selection;
    if (!s) return;
    if (s.kind === 'building') {
      const b = this.data.buildings;
      this.flyTo(b.x[s.building], b.z[s.building], Math.max(140, b.height(s.building) * 5), 0.55);
    } else if (s.kind === 'poi') this.flyTo(s.poi.x, s.poi.z, 900, 0.6);
    else if (s.kind === 'incident') this.flyTo(s.incident.x, s.incident.z, 1500, 0.7);
    else if (s.kind === 'road' || s.kind === 'ground') this.flyTo(s.x, s.z, 600, 0.6);
  }

  // --- Search ----------------------------------------------------------------------------------------------

  async ensureAddresses() {
    if (!this.addresses) this.addresses = await loadAddresses(BASE);
    return this.addresses;
  }

  search(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    const out = [];
    const words = q.split(/\s+/);
    const match = (s) => {
      const t = s.toLowerCase();
      return words.every((w) => t.includes(w));
    };
    for (const p of this.data.pois) {
      if (p.kind === 'brewery') continue;
      if (p.name && match(p.name)) {
        const k = p.kind === 'school' ? 'School' : p.kind === 'place' ? 'Place' : p.kind === 'venue' ? 'Venue' : p.kind === 'hospital' ? 'Hospital'
          : p.kind === 'fire' ? 'Fire' : p.kind === 'ems' ? 'EMS' : p.kind === 'police' ? 'Police' : p.kind === 'hotel' ? 'Hotel' : 'Place';
        out.push({ kind: k, text: p.name, sub: p.kind === 'school' && p.enrollment ? `${p.enrollment} students` : '', poi: p, score: p.name.toLowerCase().startsWith(q) ? 0 : 1 });
      }
    }
    if (this.addresses) {
      const a = this.addresses;
      const num = /^\d/.test(q);
      let n = 0;
      for (let i = 0; i < a.labels.length && n < 40; i++) {
        const lab = a.labels[i];
        if (num ? lab.toLowerCase().startsWith(words[0]) && match(lab) : match(lab)) {
          out.push({ kind: 'Address', text: lab, sub: '', address: i, score: 2 });
          n++;
        }
      }
    }
    // Streets.
    const names = this.net.names;
    let ns = 0;
    for (let i = 1; i < names.length && ns < 8; i++) {
      if (match(names[i])) {
        out.push({ kind: 'Street', text: names[i], sub: '', street: i, score: 3 });
        ns++;
      }
    }
    out.sort((a, b) => a.score - b.score);
    return out.slice(0, 30);
  }

  pickSearch(r) {
    if (r.poi) {
      this.select({ kind: 'poi', poi: r.poi });
      this.flyTo(r.poi.x, r.poi.z, r.poi.kind === 'place' ? 3500 : 900, 0.6);
    } else if (r.address !== undefined) {
      const a = this.addresses;
      const x = a.x[r.address];
      const z = a.z[r.address];
      const bi = a.building[r.address];
      if (bi >= 0) this.select({ kind: 'building', building: bi, address: a.labels[r.address] });
      else this.select({ kind: 'ground', x, z, address: a.labels[r.address] });
      this.flyTo(x, z, 260, 0.6);
    } else if (r.street) {
      // Fly to the middle of the street's longest stretch.
      const net = this.net;
      let best = -1;
      let bestL = 0;
      for (let e = 0; e < net.edgeCount; e++) if (net.nameId[e] === r.street && net.len[e] > bestL) { bestL = net.len[e]; best = e; }
      if (best >= 0) {
        const p = net.pointAt(best, net.len[best] / 2, { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0 });
        this.select({ kind: 'road', geom: net.geom[best], x: p.x, z: p.z });
        this.flyTo(p.x, p.z, 700, 0.55);
      }
    }
  }

  // --- Controls used by the HUD --------------------------------------------------------------------------------

  syncControls() {
    const mode = this.rig.mode === 'drive' ? 'follow' : this.rig.mode;
    this.hud.syncControls({ paused: this.paused, speed: this.speed, camera: mode, weather: this.world.weather.mode });
  }

  togglePause() {
    this.paused = !this.paused;
    this.syncControls();
  }

  setSpeed(s) {
    this.speed = s;
    this.paused = false;
    this.prefs.speed = s;
    savePrefs(this.prefs);
    this.syncControls();
  }

  setHour(h) {
    this.world.clock.setHour(h);
    if (this.world.onClockJump) this.world.onClockJump();
  }

  setWeather(mode) {
    this.world.weather.setMode(mode);
    this.syncControls();
  }

  /**
   * Start the clock CATCH_UP_MIN early and fast-forward to the start time in the frame loop, so the
   * roads fill with traffic while the map is already on screen (a blocking warm-up would take a minute).
   */
  startCatchUp(w, startHour = null) {
    if (!w.warmup) return;
    const sc = w.scenario;
    w.setScenario(sc, { startHour: startHour ?? sc.startHour, warmupMinutes: CATCH_UP_MIN });
    if (this.catchUp) w.autoSample = this.catchUp.auto;
    this.catchUp = { until: w.time + CATCH_UP_MIN * 60, auto: w.autoSample };
    w.autoSample = false; // don't thin trips just because the fast-forward can't hit full speed
    this.hud?.toast?.('Filling the roads: fast-forwarding the first 20 minutes', 4000);
  }

  setScenario(id, hour = null) {
    this.world.setScenario(id);
    this.startCatchUp(this.world, hour ?? (id === 'weekday' ? 8 : null));
    this.prefs.scenario = id;
    savePrefs(this.prefs);
    this._freeToDest = null;
    this.hud.renderPanel();
    this.syncControls();
  }

  setSample(f) {
    this.prefs.sample = f;
    savePrefs(this.prefs);
    if (this.world.setSample) this.world.setSample(f);
  }

  setQuality(q, byUser = false) {
    this.stage.setQuality(q);
    const s = QUALITY[this.stage.quality];
    this.atmos.setShadowQuality(s.shadowSize, s.shadows);
    this.stage.scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.needsUpdate = true;
    });
    if (this.trees) for (const m of [this.trees.dec, this.trees.eve]) m.castShadow = this.stage.quality === 'high';
    this.prefs.quality = this.stage.quality;
    if (byUser) this.prefs.qualityChosen = true;
    savePrefs(this.prefs);
    document.getElementById('qualitySelect').value = this.stage.quality;
  }

  setCamera(mode) {
    if (mode === 'orbit') {
      if (this.rig.mode === 'top') this.rig.toggleTop(false);
      else this.rig.release();
    } else if (mode === 'top') this.rig.toggleTop(true);
    else if (mode === 'tour') this.rig.tour(new THREE.Vector3(0, this.heightAt(0, 0), 2000));
    else if (mode === 'follow') {
      let v = this.selection && this.selection.kind === 'vehicle' ? this.selection.vehicle : null;
      if (!v) v = this.nearestVehicle();
      if (v) {
        this.select({ kind: 'vehicle', vehicle: v });
        this.rig.follow(v, this.world);
      } else this.hud.toast('No vehicles nearby to follow yet.');
    }
    this.syncControls();
  }

  nearestVehicle() {
    const f = this.rig.focus;
    const pose = { x: 0, y: 0, z: 0, dx: 1, dy: 0, dz: 0 };
    let best = null;
    let bestD = Infinity;
    for (const v of this.world.vehicles) {
      if (v.fade < 1) continue;
      this.world.pose(v, pose);
      const d = (pose.x - f.x) ** 2 + (pose.z - f.z) ** 2 + (v.v < 1 ? 4000 : 0);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  followSelected() {
    const v = this.selection && this.selection.kind === 'vehicle' ? this.selection.vehicle : null;
    if (!v) return;
    if (this.rig.mode === 'follow' && this.rig.vehicle === v) this.rig.release();
    else this.rig.follow(v, this.world);
    this.syncControls();
  }

  toggleDrive() {
    const v = this.rig.vehicle || (this.selection && this.selection.kind === 'vehicle' ? this.selection.vehicle : null);
    if (!v) {
      this.hud.toast('Select a vehicle first, then take the driver’s seat.');
      return;
    }
    if (this.rig.mode === 'drive') this.rig.follow(v, this.world);
    else {
      this.select({ kind: 'vehicle', vehicle: v });
      this.rig.drive(v);
    }
    this.syncControls();
  }

  // --- Frame loop ----------------------------------------------------------------------------------------------

  frame(now) {
    requestAnimationFrame(this.frame);
    const raw = Math.min(0.5, Math.max(0, (now - this.last) / 1000));
    const dt = Math.min(0.1, raw);
    this.last = now;
    const w = this.world;
    let speed = this.paused ? 0 : this.speed;
    if (this.catchUp) {
      if (w.time >= this.catchUp.until) {
        w.autoSample = this.catchUp.auto;
        this.catchUp = null;
      } else if (!this.paused) {
        speed = Math.max(speed, 600); // the engine switches to 1 s steps above 240x
      }
    }
    w.step(dt, speed);
    shared.uTime.value += dt;
    const t = shared.uTime.value;
    const cam = this.stage.camera;
    const wx = w.weather;
    const camH = this.rig.heightAboveGround;
    const k = this.atmos.update(this.sunDir(), this.moonDir(), wx, this.rig.focus, this.rig.distance, dt, camH);
    const night = this.atmos.state.night;
    const lightsOn = Math.min(1, Math.max(night, smoothstep(0.7, 1.0, wx.cloud) * 0.45 + wx.fog * 0.35 + wx.rain * 0.2));
    shared.uNight.value = lightsOn;
    const lit = w.litShares ? w.litShares() : [0.5, 0.5, 0.5, 0.5, 0.5];
    shared.uLit.value.set(lit[0], lit[1], lit[2], lit[3]);
    shared.uLitCivic.value = lit[4];
    shared.uWet.value = wx.wet;
    shared.uRain.value = wx.rain;
    shared.uSnow.value = wx.snowCover ?? (wx.kind === 'snow' ? 0.85 : 0);
    shared.uDoy.value = w.clock.dayOfYear ?? 293;
    shared.uCamPos.value.copy(cam.position);
    const ph = this.stage.container.clientHeight * this.stage.pixelRatio;
    shared.uPixelAngle.value = (2 * Math.tan((cam.fov * Math.PI) / 360)) / Math.max(1, ph / this.stage.pixelRatio);
    this.stage.renderer.toneMappingExposure = k.exposure * (1 + wx.flash * 0.5);
    this.stage.bloom.strength = 0.1 + lightsOn * 0.32;

    this.terrain.update(cam);
    this.trees.update(this.rig.focus, Math.min(camH, this.rig.distance), w.clock.dayOfYear ?? 293, shared.uSnow.value);
    if (!this.buildings.complete) {
      this.buildings.buildSome(this.buildings.done < 40000 ? 14 : 8);
    }
    const detail = Math.max(900, Math.min(4000, camH * 3));
    this.vehicles.hidden = this.rig.mode === 'drive' ? this.rig.vehicle : null;
    this.vehicles.update(w, cam, lightsOn, detail);
    this.markers.update(cam, this.stage.container.clientHeight);
    this.markers.tick(t);
    this.rain.update(t, cam, wx.rain, wx.wind, night, wx.snow || 0);

    // Congestion colors and incident routes at a few Hz.
    this._slow = (this._slow || 0) + dt;
    if (this._slow > 0.5) {
      this._slow = 0;
      if (w.congestion) this.roads.setCongestion(w.congestion);
      this.updateIncidentRoutes();
    }
    this.rig.update(raw, w);
    this.atmos.followCamera(cam);
    const rect = this.stage.container.getBoundingClientRect();
    if (this.hud.labelsOn) this.labels.update(cam, rect, Math.max(camH, this.rig.distance * 0.5));
    if (this.labUI && this.labUI.pins) this.labUI.frame(cam, rect);
    this.hud.frame(dt);
    this.watchPerformance(dt);
    this.stage.render();
  }

  updateIncidentRoutes() {
    const em = this.world.emergency;
    if (!em) return;
    const live = new Set();
    for (const inc of em.incidents) {
      if (inc.status === 'closed') continue;
      for (const [k, u] of (inc.units || []).entries()) {
        const id = `inc-${inc.id}-${k}`;
        live.add(id);
        if (u.route && !u.arrived && !this.routes.items.has(id)) {
          const col = u.kind === 'police' ? '#4d7cff' : u.kind === 'ems' ? '#ff4d6d' : '#ff7a3d';
          this.routes.setRoute(id, u.route, col, { width: 8, minPx: 4, flow: 1.6 });
        }
        if (u.arrived && this.routes.items.has(id)) this.routes.remove(id);
      }
      if (inc.transport && inc.transport.route) {
        const id = `inc-${inc.id}-tx`;
        live.add(id);
        if (!inc.transport.arrived && !this.routes.items.has(id)) this.routes.setRoute(id, inc.transport.route, '#ff4d6d', { width: 8, minPx: 4, flow: 1.6 });
        if (inc.transport.arrived) this.routes.remove(id);
      }
    }
    for (const id of [...this.routes.items.keys()]) if (id.startsWith('inc-') && !live.has(id)) this.routes.remove(id);
    if (em.incidents.some((i) => i.status === 'closed' && !i._unmarked)) {
      for (const i of em.incidents) if (i.status === 'closed') i._unmarked = true;
      this.refreshIncidentMarkers();
    }
  }

  watchPerformance(dt) {
    const p = this.perf;
    if (p.checked || this.prefs.qualityChosen || document.hidden || !this.buildings.complete) return;
    if (p.warmup > 0) {
      p.warmup -= dt;
      return;
    }
    p.time += dt;
    p.frames++;
    if (p.time < 4) return;
    const fps = p.frames / p.time;
    p.time = 0;
    p.frames = 0;
    const order = ['low', 'medium', 'high'];
    const i = order.indexOf(this.stage.quality);
    if (fps < 24 && i > 0) {
      this.setQuality(order[i - 1]);
      this.hud.toast(`Switched to ${QUALITY[order[i - 1]].label.toLowerCase()} graphics to keep things smooth.`);
      p.warmup = 3;
    } else {
      p.checked = true;
    }
  }
}

/** Minimal stand-in for the World API: a clock and free-flow drive times, no vehicles. */
class StillWorld {
  constructor(data, router, startHour = 7.25) {
    this.data = data;
    this.net = data.roads;
    this.router = router;
    this.vehicles = [];
    this.congestion = new Float32Array(this.net.edgeCount).fill(1);
    this.scenarios = [];
    this.events = [];
    this.scenario = { id: 'still', label: 'Map only', description: '' };
    this.demand = 1;
    const t0 = startHour * 3600;
    const date = new Date(2026, 9, 20);
    this.clock = {
      t: t0, date, dayOfYear: 293,
      get hour() { return this.t / 3600; },
      setHour(h) { this.t = h * 3600; },
      sunDirection(out) {
        const th = ((this.t / 3600 - 6.9) / 11.6) * Math.PI;
        const up = Math.sin(th);
        out[0] = Math.cos(th); out[1] = up * 0.75; out[2] = up * 0.45 + 0.1;
        const l = Math.hypot(out[0], out[1], out[2]);
        out[0] /= l; out[1] /= l; out[2] /= l;
        return out;
      },
      moonDirection(out) { this.sunDirection(out); out[0] = -out[0]; out[1] = -out[1]; return out; },
    };
    this.weather = { kind: 'clear', mode: 'clear', cloud: 0.15, rain: 0, fog: 0, wind: 0.3, wet: 0, flash: 0, snow: 0, setMode(m) { this.mode = m; this.kind = m === 'auto' ? 'clear' : m; }, temperature: () => 16 };
    this.emergency = {
      stations: data.pois.filter((p) => ['fire', 'ems', 'police'].includes(p.kind)),
      incidents: [],
      call: () => null,
      responseTimes: (kind, o = {}) => {
        const k = kind === 'medical' ? ['fire', 'ems'] : [kind];
        const src = this.emergency.stations.filter((s) => k.includes(s.kind)).map((s) => ({ node: s.node, t0: 140 }));
        for (const x of o.extra || []) src.push({ node: x.node, t0: 140 });
        const w = new Float32Array(this.net.ffTime.length);
        for (let e = 0; e < w.length; e++) w[e] = this.net.ffTime[e] / 1.15;
        return this.router.dijkstra(src, w, {});
      },
    };
  }

  step(dt, speed) { this.clock.t = (this.clock.t + dt * speed) % 86400; }
  pose(v, out) { return out; }
  stats() { return { active: 0, avgSpeedKmh: 0, congestionIndex: 1, completedToday: 0 }; }
  liveWeights() { return this.net.ffTime; }
  typicalWeights() { return this.net.ffTime; }
  setScenario() {}
  setDemand() {}
  setEvent() {}
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!webglAvailable()) {
  document.getElementById('loaderStep').textContent = 'This browser can’t run WebGL 2, which the 3D view needs.';
} else {
  const app = new App();
  app.start().catch((err) => {
    console.error(err);
    document.getElementById('loaderStep').textContent = 'Something went wrong while building the county. Reload to try again.';
  });
}

export { App, KIND, RESIDENTIAL_KINDS };

// The student-facing layer on top of the simulation: the ask bar, answer cards with their evidence,
// numbered pins on the map, the questions panel, the welcome screen and the notebook button.

import * as THREE from 'three';
import { Lab } from './core.js';
import { Asker, QUESTION_BANK, fmt } from './ask.js';
import { BADGES, GLOSSARY, GROUPS, METRIC_BY_ID } from './catalog.js';
import { chartHtml } from './charts.js';
import { Notebook } from './notebook.js';
import { loadJSON } from '../data/bundle.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(`ask-asheville:${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`ask-asheville:${k}`, JSON.stringify(v)); } catch { /* optional */ } },
};

export function badgeHtml(kind) {
  const b = BADGES[kind];
  return b ? `<span class="badge badge-${kind}" title="${esc(b.tip)}">${b.label}</span>` : '';
}

/** Numbered pins drawn over the map at ground points. */
class Pins {
  constructor(app) {
    this.app = app;
    this.root = document.createElement('div');
    this.root.className = 'pins';
    document.body.appendChild(this.root);
    this.items = [];
    this.v = new THREE.Vector3();
  }

  set(list) {
    this.root.innerHTML = '';
    this.items = list.map((p) => {
      const el = document.createElement('button');
      el.className = `pin${p.n === '' ? ' pin-dot' : ''}`;
      el.type = 'button';
      el.innerHTML = `<b><i>${esc(p.n === '' ? '' : p.n)}</i></b><span>${esc(p.label || '')}</span>`;
      el.setAttribute('aria-label', `${p.n ? `${p.n}: ` : ''}${p.label || 'Marked spot'}. Fly here.`);
      el.addEventListener('click', () => this.app.flyTo(p.x, p.z, 2200, 0.6));
      this.root.appendChild(el);
      return { ...p, el, y: this.app.heightAt(p.x, p.z) };
    });
  }

  clear() {
    this.set([]);
  }

  update(camera, rect) {
    const v = this.v;
    for (const it of this.items) {
      v.set(it.x, it.y + 6, it.z).project(camera);
      const show = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;
      it.el.style.display = show ? '' : 'none';
      if (show) {
        it.sx = (v.x * 0.5 + 0.5) * rect.width;
        it.sy = (-v.y * 0.5 + 0.5) * rect.height;
        it.el.style.transform = `translate(${it.sx.toFixed(1)}px, ${it.sy.toFixed(1)}px)`;
      } else it.sx = undefined;
    }
  }
}

/** Everything an answer can do to the map. */
class MapView {
  constructor(app, lab, pins) {
    this.app = app;
    this.lab = lab;
    this.pinLayer = pins;
  }

  /** Back to a plain map (keeps the camera, the day and the clock). */
  reset() {
    const app = this.app;
    app.clearDriveMap();
    app.hud.mapState.metric = '';
    app.hud.mapState.lo = null;
    app.hud.mapState.hi = null;
    app.overlays.setMetric(null);
    app.overlays.clearHighlight();
    app.routes.remove('ask-route');
    this.pinLayer.clear();
    app.hud.renderLegend();
    if (app.hud.tab === 'map') app.hud.renderPanel();
  }

  clearAreas() { /* answers call this to say "no area colors"; reset() has already run */ }

  layer(id) {
    const hud = this.app.hud;
    hud.mapState = { ...hud.mapState, metric: id, lo: null, hi: null };
    hud.applyMetric();
    if (hud.tab === 'map') hud.renderPanel();
  }

  outline(ent) {
    this.app.overlays.setHighlight(this.lab.blocksOf(ent), ent.type === 'town' || ent.type === 'county' ? ent.name : `Around ${ent.name}`);
    this.app.hud.renderLegend();
  }

  heat(times, { name, basis = 'free', maxMinutes = 30, bandMinutes = 5 }) {
    const app = this.app;
    app.driveMap = { target: { name }, basis, times };
    app.coverage = null;
    app.overlays.showHeat(times, { maxMinutes, bandMinutes, onRoads: true });
    app.hud.renderLegend();
  }

  coverage(kind, basis = 'free') {
    this.app.hud.showCoverage(kind === 'ems' ? 'ems' : kind, basis);
  }

  route(edges) {
    this.app.routes.setRoute('ask-route', edges, '#ffc93c', { width: 10, minPx: 5 });
  }

  pins(list) {
    this.pinLayer.set(list);
  }

  markers(kinds) {
    const set = new Set(this.app.markers.visible);
    for (const k of kinds) set.add(k);
    this.app.markers.setCategories(set);
  }

  roads(mode) {
    this.app.overlays.setRoadMode(mode);
  }

  top() {
    if (this.app.rig.mode !== 'top') this.app.setCamera('top');
  }

  orbit() {
    const rig = this.app.rig;
    if (rig.mode === 'top') rig.toggleTop(false);
    else if (rig.mode !== 'orbit') rig.release();
    this.app.syncControls();
  }

  /** Pixels of the window covered by panels on each side, so the map's subject lands in the open part. */
  pad() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const col = document.getElementById('colRight').getBoundingClientRect();
    const open = !document.getElementById('answer').hidden || !document.getElementById('inspector').hidden;
    if (w <= 860) {
      // Phones and small tablets: the answer is a sheet over the lower part of the map.
      return { left: 0, right: 0, top: 120, bottom: open ? Math.min(h * 0.62, h - col.top + 8) : 160 };
    }
    const panel = document.getElementById('panel');
    const left = panel.hidden ? 126 : panel.getBoundingClientRect().right + 8;
    return { left, right: open ? w - col.left + 8 : 0, top: 70, bottom: 82 };
  }

  /** How far (meters east, south) to shift a view so its subject sits in the middle of the open part of the map. */
  offset(dist) {
    const app = this.app;
    const cam = app.stage.camera;
    const { left, right, top, bottom } = this.pad();
    const mpp = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / window.innerHeight;
    const dx = ((right - left) / 2) * mpp;
    const dy = ((bottom - top) / 2) * mpp;
    let rx = 1; let rz = 0; let fx = 0; let fz = -1; let tilt = 1;
    if (app.rig.mode !== 'top') {
      const e = cam.matrixWorld.elements;
      const l = Math.hypot(e[0], e[2]) || 1;
      rx = e[0] / l; rz = e[2] / l;
      const fl = Math.hypot(e[8], e[10]) || 1;
      fx = -e[8] / fl; fz = -e[10] / fl;
      // Looking across the ground instead of straight down stretches a screen pixel along the view direction.
      tilt = 1 / Math.max(0.45, Math.abs(e[9]));
    }
    return [rx * dx - fx * dy * tilt, rz * dx - fz * dy * tilt];
  }

  fly(x, z, dist, pitch = null) {
    this.app.flyTo(x, z, dist, pitch);
  }

  county() {
    this.top();
    this.fit(-31500, 35600, -26400, 20800, 1.0);
  }

  home() {
    this.orbit();
    this.app.rig.home(false);
  }

  /** Top-down view that fits a box (meters) inside the open part of the map. */
  fit(x0, x1, z0, z1, margin = 1.3, minDist = 3500) {
    const cam = this.app.stage.camera;
    const { left, right, top, bottom } = this.pad();
    const w = window.innerWidth; const h = window.innerHeight;
    const t = 2 * Math.tan((cam.fov * Math.PI) / 360);
    const usableW = Math.max(200, w - left - right);
    const usableH = Math.max(120, h - top - bottom);
    const dist = Math.max(minDist, ((x1 - x0) * margin * h) / (usableW * t), ((z1 - z0) * margin * h) / (usableH * t));
    this.top();
    this.fly((x0 + x1) / 2, (z0 + z1) / 2, dist);
  }

  framePoints(pts, minDist = 4000, pitch = null) {
    let x0 = Infinity; let x1 = -Infinity; let z0 = Infinity; let z1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    if (pitch === null) { this.fit(x0, x1, z0, z1, 1.45, minDist); return; }
    const span = Math.max(x1 - x0, (z1 - z0) * 1.5);
    this.orbit();
    this.fly((x0 + x1) / 2, (z0 + z1) / 2, Math.max(minDist, span * 1.6 + 2500), pitch);
  }

  frameEnt(ent) {
    if (ent.type === 'town') {
      const { x, z, w } = this.lab.blockXY;
      const pts = this.lab.blocksOf(ent).filter((k) => w[k]).map((k) => ({ x: x[k], z: z[k] }));
      if (pts.length) { this.framePoints(pts, 6000); return; }
    }
    const r = ent.radius || 900;
    this.fit(ent.x - r, ent.x + r, ent.z - r, ent.z + r, 1.7, 4500);
  }

  flyEvent(id) {
    const ev = (this.app.world.events || []).find((e) => e.id === id);
    const p = ev && this.app.data.pois.find((q) => q.id === ev.venue);
    if (p) this.fly(p.x, p.z, 3200, 0.6); else this.home();
  }

  scenario(id, hour = null) {
    if (this.app.world.scenario?.id !== id || hour !== null) this.app.setScenario(id, hour);
  }

  hour(h) {
    this.app.setHour(((h % 24) + 24) % 24);
  }
}

export class LabUI {
  constructor(app) {
    this.app = app;
    this.answer = null;
    this.history = [];
    this.guide = null; // guided investigations (set by investigations.js when it loads)
  }

  async init() {
    const app = this.app;
    const [places, summary] = await Promise.all([loadJSON('./data/places.json'), loadJSON('./data/typical_summary.json').catch(() => null)]);
    app.typicalSummary = summary;
    this.lab = new Lab(app, places);
    this.lab.restoreMySpot();
    // Plain-language names for the map layers everywhere they appear.
    for (const m of app.data.areas.metrics) {
      const c = METRIC_BY_ID[m.id];
      if (c) { m.label = c.label; m.group = c.group; m.def = c.def; }
    }
    app.overlays.metricById = Object.fromEntries(app.data.areas.metrics.map((m) => [m.id, m]));
    this.pins = new Pins(app);
    this.view = new MapView(app, this.lab, this.pins);
    this.asker = new Asker(this.lab, this.view);
    this.notebook = new Notebook({
      capture: () => this.capture(),
      toast: (t) => app.hud.toast(t),
      onChange: () => this.syncNotebookCount(),
    });
    this.bindAskBar();
    this.bindStatic();
    this.syncNotebookCount();
    app.lab = this;
    try {
      const mod = await import('./investigations.js');
      this.guide = new mod.Guide(this);
    } catch (err) {
      console.warn('Guided investigations are unavailable.', err);
    }
    this.fromHash();
    window.addEventListener('hashchange', () => this.fromHash());
    if (!location.hash && !store.get('welcomed', false)) this.showWelcome();
  }

  /** Per-frame: keep the pins on their spots. */
  frame(camera, rect) {
    this.pins.update(camera, rect);
  }

  // --- Asking --------------------------------------------------------------------------------------------

  /** Answer a question and show it. Returns the answer. */
  async ask(text, { quiet = false, from = 'typed' } = {}) {
    const q = String(text || '').trim().slice(0, 200);
    if (!q) return null;
    // Addresses load lazily; a question with a house number waits for them.
    if (/\b\d{1,5}\s+[a-z]/i.test(q) && !this.app.addresses) await this.app.ensureAddresses().catch(() => null);
    const a = this.asker.ask(q);
    a.from = from;
    this.answer = a;
    this.view.reset();
    // Draw the card first: the map view is framed in the space the card leaves open.
    this.renderAnswer();
    try {
      a.show?.();
    } catch (err) {
      console.error('Could not show the answer on the map', err);
    }
    // On a phone the tool panel would sit on top of the answer.
    if (window.innerWidth <= 860 && from !== 'guide' && this.app.hud.tab) this.app.hud.openTab(null);
    if (!quiet) {
      this.history = [q, ...this.history.filter((h) => h !== q)].slice(0, 12);
      $('askInput').value = q;
      history.replaceState(null, '', `#q=${encodeURIComponent(q)}`);
    }
    if (this.guide?.onAnswer) this.guide.onAnswer(a);
    return a;
  }

  /** Show an answer that was built directly (a map click, a layer button) instead of typed. */
  present(a, question) {
    if (!a) return;
    a.question = question;
    a.sources ||= [];
    a.figures ||= [];
    a.follow = (a.follow || []).slice(0, 4);
    this.answer = a;
    this.view.reset();
    this.renderAnswer();
    try { a.show?.(); } catch (err) { console.error(err); }
  }

  /** "Ask about this area" from a clicked building or spot. */
  askPoint(x, z, name) {
    const ent = this.lab.pointEntity(x, z, name);
    this.present(this.asker.profile(ent), `Tell me about the area around ${name}`);
  }

  askPoi(p) {
    const ent = this.lab.gaz.fromPoi(p);
    this.present(this.asker.profile(ent), `Tell me about ${ent.name}`);
  }

  setMySpot(spot) {
    this.lab.setMySpot(spot);
    this.app.hud.toast('This is now “my spot”, saved only in this browser. Try: How long does it take to drive from my spot to downtown?', 8000);
    $('askInput').value = 'How long does it take to drive from my spot to downtown?';
  }

  fromHash() {
    let h = '';
    try {
      h = decodeURIComponent(location.hash.slice(1));
    } catch {
      return; // a mangled link: ignore it
    }
    if (h.startsWith('q=') && h.length > 2) {
      const q = h.slice(2).replace(/\+/g, ' ').slice(0, 200);
      if (!this.answer || this.answer.question !== q) this.ask(q);
    } else if (h.startsWith('i=') && this.guide) this.guide.open(h.slice(2));
  }

  closeAnswer(clearMap = true) {
    this.answer = null;
    $('answer').hidden = true;
    document.body.classList.remove('has-answer');
    if (clearMap) this.view.reset();
    if (location.hash.startsWith('#q=')) history.replaceState(null, '', location.pathname + location.search);
  }

  renderAnswer() {
    const a = this.answer;
    const el = $('answer');
    if (!a) { el.hidden = true; return; }
    const figs = (a.figures || []).map((f) => (f.wide
      ? `<li class="fig fig-wide"><span>${esc(f.value)}</span></li>`
      : `<li class="fig"><span class="fig-l">${f.pin ? `<i class="pin-n">${f.pin}</i>` : ''}${esc(f.label)}</span><span class="fig-v">${esc(f.value)}${badgeHtml(f.badge)}</span></li>`)).join('');
    const table = a.table ? `<table class="cmp"><thead><tr><th></th><th>${esc(a.table.cols[0])}</th><th>${esc(a.table.cols[1])}</th></tr></thead><tbody>${
      a.table.rows.map((r) => `<tr><th>${esc(r.label)}</th><td class="${r.va > r.vb ? 'hi' : ''}">${esc(r.a)}</td><td class="${r.vb > r.va ? 'hi' : ''}">${esc(r.b)}</td></tr>`).join('')}</tbody></table>` : '';
    const words = this.wordsFor(a);
    const saved = this.notebook.has(a.question);
    el.dataset.miss = a.miss ? 'true' : 'false';
    el.innerHTML = `
      <header class="ans-head">
        <div class="ans-q"><span class="eyebrow">${a.miss ? 'Hmm' : 'You asked'}</span><p>${esc(a.question)}</p></div>
        <button class="icon-btn" id="ansClose" aria-label="Close this answer"><svg><use href="#i-close"/></svg></button>
      </header>
      <div class="ans-scroll">
        <h2 class="ans-headline">${esc(a.headline)}</h2>
        <p class="ans-sub">${esc(a.sub || '')}</p>
        ${table || (figs ? `<ul class="figs">${figs}</ul>` : '')}
        ${table ? '' : chartHtml(a.chart)}
        ${a.map ? `<p class="ans-map"><svg aria-hidden="true"><use href="#i-eye"/></svg><span>${esc(a.map)}</span></p>` : ''}
        ${(a.actions || []).map((x, i) => `<button class="action ans-act" data-act="${i}"><svg aria-hidden="true"><use href="#i-plus"/></svg><span>${esc(x.label)}</span></button>`).join('')}
        ${a.miss ? '' : `<details class="ans-how"><summary>How do we know?</summary>
          ${a.sources.length ? `<p class="how-h">Where the numbers come from</p><ul>${a.sources.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
          ${a.caveat ? `<p class="how-h">Keep in mind</p><p>${esc(a.caveat)}</p>` : ''}
          ${this.badgeKey(a)}
          ${words.length ? `<p class="how-h">Words to know</p><dl class="gloss">${words.map((w) => `<dt>${esc(w.term)}</dt><dd>${esc(w.def)}</dd>`).join('')}</dl>` : ''}
        </details>`}
        ${a.follow?.length ? `<div class="ans-follow"><span class="eyebrow">${a.miss ? 'Try one of these' : 'Ask next'}</span>${a.follow.map((f) => `<button class="follow" data-q="${esc(f)}">${esc(f)}</button>`).join('')}</div>` : ''}
      </div>
      ${a.miss ? '' : `<footer class="ans-foot">
        <button class="primary" id="ansSave" ${saved ? 'disabled' : ''}><svg aria-hidden="true"><use href="#i-book"/></svg><span>${saved ? 'Saved to notebook' : 'Save to notebook'}</span></button>
        <button class="action" id="ansShow" title="Show this answer on the map again"><svg aria-hidden="true"><use href="#i-target"/></svg><span>Show again</span></button>
        <button class="icon-btn" id="ansLink" title="Copy a link to this question" aria-label="Copy a link to this question"><svg aria-hidden="true"><use href="#i-link"/></svg></button>
      </footer>`}`;
    el.hidden = false;
    document.body.classList.add('has-answer');
    $('stats').dataset.collapsed = 'true';
    $('statsToggle').setAttribute('aria-expanded', 'false');
    el.querySelector('.ans-scroll').scrollTop = 0;
    $('ansClose').addEventListener('click', () => this.closeAnswer());
    for (const b of el.querySelectorAll('.follow')) b.addEventListener('click', () => this.ask(b.dataset.q, { from: 'follow' }));
    for (const b of el.querySelectorAll('.ans-act')) b.addEventListener('click', () => { a.actions[Number(b.dataset.act)].run(); b.disabled = true; this.app.hud.toast('Added. Ask the question again to see what changed.'); });
    $('ansSave')?.addEventListener('click', () => this.saveAnswer());
    $('ansShow')?.addEventListener('click', () => { this.view.reset(); a.show?.(); });
    $('ansLink')?.addEventListener('click', () => this.copyLink());
  }

  badgeKey(a) {
    const kinds = [...new Set((a.figures || []).map((f) => f.badge).filter(Boolean))];
    if (!kinds.length) return '';
    return `<p class="how-h">What the labels mean</p><ul class="badge-key">${kinds.map((k) => `<li>${badgeHtml(k)} ${esc(BADGES[k].tip)}</li>`).join('')}</ul>`;
  }

  /** Glossary words that matter for this answer. */
  wordsFor(a) {
    const text = `${a.headline} ${a.sub} ${(a.figures || []).map((f) => f.label).join(' ')} ${a.caveat || ''}`.toLowerCase();
    const want = [];
    const add = (t) => { const g = GLOSSARY.find((x) => x.term === t); if (g && !want.includes(g)) want.push(g); };
    if (/\bmedian\b/.test(text)) add('Median');
    if (/margin of error|survey/.test(text)) add('Margin of error');
    if (/block group|neighborhood area/.test(text)) add('Block group');
    if (/\bblocks?\b/.test(text) && a.kind === 'rank') add('Census block');
    if (/correlation/.test(text)) add('Correlation');
    if (/no traffic|free flow/.test(text)) add('Free flow');
    if (/simulat/.test(text)) add('Simulation');
    if (/911|response/.test(text)) add('Response time');
    if (/per person|per capita/.test(text)) add('Per capita');
    if (/poverty/.test(text)) add('Poverty line');
    if (/household/.test(text)) add('Household');
    if (/per square mile|density/.test(text)) add('Density');
    return want.slice(0, 4);
  }

  saveAnswer() {
    const a = this.answer;
    if (!a || a.miss) return;
    this.notebook.add({
      kind: 'answer', question: a.question, headline: a.headline, detail: a.sub,
      figures: (a.figures || []).filter((f) => !f.wide).slice(0, 8).map((f) => ({ label: f.label, value: f.value, badge: f.badge })),
      sources: a.sources, caveat: a.caveat, investigation: this.guide?.currentTitle?.() || undefined,
    });
    const b = $('ansSave');
    if (b) { b.disabled = true; b.querySelector('span').textContent = 'Saved to notebook'; }
    this.app.hud.toast('Saved to your notebook with a picture of the map.');
    $('nbBtn').classList.add('bump');
    setTimeout(() => $('nbBtn').classList.remove('bump'), 600);
  }

  async copyLink() {
    const url = `${location.origin}${location.pathname}#q=${encodeURIComponent(this.answer.question)}`;
    try {
      await navigator.clipboard.writeText(url);
      this.app.hud.toast('Link copied. Anyone who opens it sees this question answered.');
    } catch {
      this.app.hud.toast(url, 9000);
    }
  }

  /** A small picture of the current map, with the pins drawn on. */
  capture() {
    try {
      const app = this.app;
      app.stage.render();
      const src = app.stage.renderer.domElement;
      const w = 640;
      const h = Math.round((src.height / src.width) * w);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(src, 0, 0, w, h);
      const k = w / src.clientWidth;
      ctx.font = '700 12px Overpass, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of this.pins.items) {
        if (p.sx === undefined) continue;
        const x = p.sx * k; const y = p.sy * k - 11;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#ffc93c'; ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = '#1a1405'; ctx.stroke();
        ctx.fillStyle = '#1a1405';
        if (p.n !== '') ctx.fillText(String(p.n), x, y + 1);
      }
      return c.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  }

  syncNotebookCount() {
    const n = this.notebook.count;
    const b = $('nbCount');
    b.textContent = String(n);
    b.hidden = n === 0;
    $('nbBtn').setAttribute('aria-label', `Open my notebook (${n} saved)`);
  }

  // --- Ask bar ---------------------------------------------------------------------------------------------

  bindAskBar() {
    const app = this.app;
    const input = $('askInput');
    const ul = $('askResults');
    let rows = [];
    let active = -1;
    const all = QUESTION_BANK.flatMap((g) => g.qs);
    const starters = () => {
      const pick = [];
      QUESTION_BANK.forEach((g, i) => pick.push(g.qs[(new Date().getMinutes() + i * 3) % g.qs.length]));
      return pick;
    };
    const build = () => {
      const v = input.value.trim();
      rows = [];
      if (!v) {
        for (const q of this.history.slice(0, 3)) rows.push({ kind: 'Recent', text: q, ask: q });
        for (const q of starters()) if (!rows.some((r) => r.ask === q)) rows.push({ kind: 'Try', text: q, ask: q });
        return;
      }
      const looksLikeQuestion = /\s/.test(v) && /^(how|what|where|which|when|who|why|is|are|do|does|can|compare|show|tell|find|list)\b/i.test(v);
      const places = app.search(v);
      if (looksLikeQuestion || !places.length) rows.push({ kind: 'Ask', text: v, ask: v, strong: true });
      const words = v.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const sugg = all.map((q) => ({ q, s: words.reduce((n, w) => n + (q.toLowerCase().includes(w) ? 1 : 0), 0) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 4);
      for (const s of sugg) if (s.q.toLowerCase() !== v.toLowerCase()) rows.push({ kind: 'Try', text: s.q, ask: s.q });
      for (const p of places.slice(0, looksLikeQuestion ? 4 : 9)) rows.push({ kind: p.kind, text: p.text, sub: p.sub, place: p });
      if (!looksLikeQuestion && places.length) rows.push({ kind: 'Ask', text: v, ask: v });
    };
    const show = () => {
      ul.innerHTML = '';
      rows.forEach((r, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `askOpt${i}`;
        li.setAttribute('aria-selected', String(i === active));
        li.className = r.ask ? `row-ask${r.strong ? ' strong' : ''}` : 'row-place';
        li.innerHTML = `<span class="k">${esc(r.kind)}</span><span class="t">${esc(r.text)}</span><span class="s">${esc(r.sub || '')}</span>`;
        li.addEventListener('mousedown', (e) => { e.preventDefault(); pick(r); });
        ul.append(li);
      });
      ul.hidden = rows.length === 0;
      input.setAttribute('aria-expanded', String(rows.length > 0));
      input.setAttribute('aria-activedescendant', active >= 0 ? `askOpt${active}` : '');
    };
    const pick = (r) => {
      ul.hidden = true;
      input.blur();
      if (r.ask) this.ask(r.ask);
      else if (r.place) { app.pickSearch(r.place); input.value = ''; }
    };
    const submit = () => {
      if (active >= 0 && rows[active]) pick(rows[active]);
      else if (input.value.trim()) { ul.hidden = true; input.blur(); this.ask(input.value); }
    };
    input.addEventListener('focus', () => { active = -1; build(); show(); app.ensureAddresses().catch(() => null); });
    input.addEventListener('input', () => { active = -1; build(); show(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(rows.length - 1, active + 1); show(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(-1, active - 1); show(); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { input.blur(); ul.hidden = true; }
    });
    input.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 160));
    $('askGo').addEventListener('click', () => { if (input.value.trim()) submit(); else input.focus(); });
  }

  bindStatic() {
    $('nbBtn').addEventListener('click', () => this.notebook.toggle());
    // The sign is the way home: a plain map and the opening view.
    const sign = document.querySelector('.hud-tl .sign');
    sign.setAttribute('role', 'button');
    sign.setAttribute('tabindex', '0');
    sign.setAttribute('aria-label', 'Ask Asheville: back to the opening view');
    sign.title = 'Back to the opening view';
    const goHome = () => { this.closeAnswer(); this.app.select(null); this.app.hud.openTab(null); this.view.roads('plain'); this.view.home(); $('askInput').value = ''; };
    sign.addEventListener('click', goHome);
    sign.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });
    $('welcomeAsk')?.addEventListener('click', () => { this.hideWelcome(); $('askInput').focus(); });
    $('welcomeGuide')?.addEventListener('click', () => { this.hideWelcome(); this.app.hud.openTab('questions'); });
    $('welcomeExplore')?.addEventListener('click', () => this.hideWelcome());
    $('welcome')?.addEventListener('click', (e) => { if (e.target === $('welcome')) this.hideWelcome(); });
    for (const b of document.querySelectorAll('[data-welcome-q]')) b.addEventListener('click', () => { this.hideWelcome(); this.ask(b.dataset.welcomeQ, { from: 'welcome' }); });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !$('welcome').hidden) this.hideWelcome();
    });
  }

  showWelcome() {
    $('welcome').hidden = false;
    setTimeout(() => $('welcomeAsk')?.focus(), 50);
  }

  hideWelcome() {
    $('welcome').hidden = true;
    store.set('welcomed', true);
  }

  // --- The Questions panel -----------------------------------------------------------------------------------

  /** Body of the "Questions" tool panel: guided investigations, then questions to try by topic. */
  panelQuestions(body) {
    if (this.guide?.active) { this.guide.renderStep(body); return; }
    body.insertAdjacentHTML('beforeend', `<p>Pick a question to investigate step by step, or try any question below. You can always type your own in the bar at the top.</p><div id="guideGallery"></div>
      <h3 class="eyebrow">Questions to try</h3>
      <div class="qbank">${QUESTION_BANK.map((g, i) => `<details ${i === 0 ? 'open' : ''}><summary>${esc(g.group)}</summary><div class="qlist">${g.qs.map((q) => `<button class="follow" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div></details>`).join('')}</div>
      <h3 class="eyebrow">Words to know</h3>
      <dl class="gloss gloss-all">${GLOSSARY.map((g) => `<dt>${esc(g.term)}</dt><dd>${esc(g.def)}</dd>`).join('')}</dl>`);
    for (const b of body.querySelectorAll('.qbank .follow')) b.addEventListener('click', () => this.ask(b.dataset.q, { from: 'bank' }));
    if (this.guide) this.guide.renderGallery($('guideGallery'));
  }

  /** Body of the "Map layers" panel: every measure by topic, in plain words. */
  panelLayers(body) {
    const app = this.app;
    const hud = app.hud;
    const cur = hud.mapState.metric;
    const byGroup = Object.fromEntries(GROUPS.map((g) => [g, []]));
    for (const m of this.lab.metrics) (byGroup[m.group] ||= []).push(m);
    body.insertAdjacentHTML('beforeend', `<p>Color every neighborhood by one measure. Yellow is high, purple is low. Move the pointer over the map to read any area.</p>
      <div class="layers">${GROUPS.filter((g) => byGroup[g]?.length).map((g) => `<div class="layer-group"><h3 class="eyebrow">${esc(g)}</h3>${byGroup[g].map((m) => `<button class="layer-row" data-id="${m.id}" aria-pressed="${m.id === cur}" title="${esc(m.def)}"><span>${esc(m.label)}</span>${badgeHtml(m.badge)}</button>`).join('')}</div>`).join('')}</div>
      <button class="action" id="layerOff" ${cur ? '' : 'hidden'}><svg aria-hidden="true"><use href="#i-close"/></svg><span>Plain map (no colors)</span></button>
      <div id="metricInfo"></div>
      <h3 class="eyebrow">Roads</h3>
      <div class="chips" id="roadMode">
        <button class="chip" data-mode="plain" aria-pressed="${(app.overlays.roadMode || 'plain') === 'plain'}">Plain</button>
        <button class="chip" data-mode="congestion" aria-pressed="${app.overlays.roadMode === 'congestion'}">Color by traffic</button>
      </div>
      <p class="note">Traffic colors show how much slower each road is than it would be empty: green is moving, red is crawling.</p>`);
    for (const b of $('roadMode').querySelectorAll('.chip')) {
      b.addEventListener('click', () => {
        app.overlays.setRoadMode(b.dataset.mode);
        for (const o of $('roadMode').querySelectorAll('.chip')) o.setAttribute('aria-pressed', String(o === b));
      });
    }
    for (const b of body.querySelectorAll('.layer-row')) {
      b.addEventListener('click', () => {
        const m = METRIC_BY_ID[b.dataset.id];
        this.present(this.asker.layer(m), `Show ${m.label.toLowerCase()} on the map`);
        // Keep the layer list where it was (the panel was just redrawn).
        const again = document.querySelector(`.layer-row[data-id="${m.id}"]`);
        again?.scrollIntoView({ block: 'nearest' });
      });
    }
    $('layerOff').addEventListener('click', () => { this.view.reset(); if (this.answer?.kind === 'layer') this.closeAnswer(false); });
    hud.renderMetricInfo();
  }
}

export { fmt, store };

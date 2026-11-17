// DOM side of the app: the county sign and clock, live traffic stats, the tool panels (day and
// events, data layers, drive times, emergency response, places), the inspector, the legend,
// search, keyboard shortcuts and settings.

import { KIND, KIND_LABEL, RESIDENTIAL_KINDS } from '../data/worldData.js';
import { formatValue, SEQ } from '../render/overlays.js';

const $ = (id) => document.getElementById(id);
const num = new Intl.NumberFormat('en-US');
const PREFS_KEY = 'ask-asheville:prefs';
const WEATHER_LABEL = { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', storm: 'Thunderstorm', fog: 'Fog', snow: 'Snow' };
const WEATHER_ICON = { clear: 'i-sun', cloudy: 'i-cloud', rain: 'i-rain', storm: 'i-storm', fog: 'i-fog', snow: 'i-snow' };
const PURPOSE_LABEL = {
  work: 'Commuting to work', home: 'Heading home', school: 'School drop-off or pick-up', shop: 'Shopping', errand: 'Errands', visit: 'Visiting',
  tourist: 'Sightseeing', event: 'Going to an event', through: 'Passing through on the interstate', emergency: 'Emergency response',
  patrol: 'On patrol', bus: 'School bus route', freight: 'Freight delivery',
};
const TYPE_LABEL = {
  sedan: 'Sedan', hatch: 'Hatchback', suv: 'SUV', van: 'Van', truck: 'Box truck', semi: 'Tractor-trailer', bus: 'ART city bus',
  schoolbus: 'School bus', ambulance: 'Ambulance', engine: 'Fire engine', police: 'Police car',
};

export function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable (private windows); preferences are optional.
  }
}

const GEO_LABEL = { bg: 'Census block groups', block: 'Census blocks', zip: 'ZIP codes' };
function areaName(geo, src, unit) {
  if (geo === 'zip') return `ZIP ${src.zip[unit]}`;
  return geo === 'bg' ? 'Block group' : 'Block';
}
/** Short display name for a destination ('downtown' for Pack Square). */
function destShort(d) {
  if (!d || d.id === 'downtown') return 'downtown';
  return d.name.replace(/ \(.*\)$/, '');
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtMin(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = sec / 60;
  if (m < 1) return '<1 min';
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}

function fmtClock(t) {
  const h = Math.floor(t / 3600) % 24;
  const m = Math.floor((t % 3600) / 60);
  const ap = h < 12 ? 'AM' : 'PM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ap}`;
}

function fmtMmSs(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export class Hud {
  constructor(app) {
    this.app = app;
    this.tab = null;
    this.history = new Array(144).fill(null);
    this.historyDay = -1;
    this.historySlot = 0;
    this.tick = 0;
    this.slowTick = 0;
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 60;
    this.selection = null;
    this.toastTimer = 0;
    this.labelsOn = true;
    this.driveBasis = 'free';
    this.driveTarget = 'dest';
    this.driveMax = 45;
    this.mapState = { metric: '', lo: null, hi: null, buildings: false, borders: true, opacity: 0.72 };
    this.bindStatic();
  }

  // --- Static wiring ------------------------------------------------------------------------------------

  bindStatic() {
    const app = this.app;
    $('playBtn').addEventListener('click', () => app.togglePause());
    for (const b of $('speedSeg').querySelectorAll('button')) b.addEventListener('click', () => app.setSpeed(Number(b.dataset.speed)));
    $('timeSlider').addEventListener('input', (e) => app.setHour(Number(e.target.value) / 60));
    // Always-visible weather and data-layer controls in the dock.
    $('dockWeather').innerHTML = ['auto', 'clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'].map((k) =>
      `<button data-weather="${k}" aria-pressed="false" title="${k === 'auto' ? 'Changing weather' : WEATHER_LABEL[k]}"><svg><use href="#${k === 'auto' ? 'i-auto' : WEATHER_ICON[k]}"/></svg><span class="sr-only">${k === 'auto' ? 'Changing weather' : WEATHER_LABEL[k]}</span></button>`).join('');
    for (const b of $('dockWeather').querySelectorAll('button')) b.addEventListener('click', () => app.setWeather(b.dataset.weather));
    $('dataChip').addEventListener('click', () => this.openTab(this.tab === 'map' ? null : 'map'));
    $('dataClear').addEventListener('click', () => {
      this.mapState.metric = '';
      this.mapState.lo = null;
      this.mapState.hi = null;
      app.overlays.setMetric(null);
      this.renderLegend();
      if (this.tab === 'map') this.renderPanel();
    });
    for (const b of $('camSeg').querySelectorAll('button')) b.addEventListener('click', () => app.setCamera(b.dataset.cam));
    $('settingsBtn').addEventListener('click', () => this.toggleDrawer());
    $('drawerClose').addEventListener('click', () => this.toggleDrawer(false));
    $('helpBtn').addEventListener('click', () => this.toggleHelp(true));
    $('helpClose').addEventListener('click', () => this.toggleHelp(false));
    $('help').addEventListener('click', (e) => {
      if (e.target === $('help')) this.toggleHelp(false);
    });
    $('inspClose').addEventListener('click', () => app.select(null));
    $('panelClose').addEventListener('click', () => this.openTab(null));
    for (const b of document.querySelectorAll('.rail-btn[data-tab]')) b.addEventListener('click', () => this.openTab(this.tab === b.dataset.tab ? null : b.dataset.tab));
    $('statsToggle').addEventListener('click', () => {
      const s = $('stats');
      const collapsed = s.dataset.collapsed !== 'true';
      s.dataset.collapsed = String(collapsed);
      $('statsToggle').setAttribute('aria-expanded', String(!collapsed));
    });
    if (window.matchMedia('(max-width: 640px)').matches) $('stats').dataset.collapsed = 'true';
    $('sampleRange').addEventListener('input', (e) => {
      $('sampleOut').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
      app.setSample(Number(e.target.value));
    });
    $('vehColor').addEventListener('change', (e) => {
      app.vehicles.colorMode = e.target.value;
    });
    $('qualitySelect').addEventListener('change', (e) => app.setQuality(e.target.value, true));
    $('labelsCheck').addEventListener('change', (e) => {
      this.labelsOn = e.target.checked;
      app.labels.root.style.display = this.labelsOn ? '' : 'none';
    });
    $('countyCheck').addEventListener('change', (e) => {
      app.terrain.material.userData.uniforms.uCounty.value = e.target.checked ? 1 : 0;
    });
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const speeds = [1, 10, 30, 60, 180, 600];
      if (k === ' ') {
        e.preventDefault();
        app.togglePause();
      } else if (['1', '2', '3', '4', '5', '6'].includes(k)) app.setSpeed(speeds[Number(k) - 1]);
      else if (k === 't') app.setCamera(app.rig.mode === 'top' ? 'orbit' : 'top');
      else if (k === 'o') app.setCamera('orbit');
      else if (k === 'c') app.setCamera('follow');
      else if (k === 'v') app.toggleDrive();
      else if (k === 'h') document.body.classList.toggle('hud-hidden');
      else if (k === '/') {
        e.preventDefault();
        $('askInput').focus();
      } else if (k === '?') this.toggleHelp(true);
      else if (k === 'escape') {
        if (!$('help').hidden) this.toggleHelp(false);
        else if (!$('drawer').hidden) this.toggleDrawer(false);
        else if (app.tool) app.setTool(null);
        else if (app.selection) app.select(null);
        else if (this.tab) this.openTab(null);
        else if (app.lab && app.lab.answer) app.lab.closeAnswer();
        else app.setCamera('orbit');
      }
    });
  }

  init() {
    const app = this.app;
    $('sampleRange').value = String(app.prefs.sample ?? 1);
    $('sampleOut').textContent = `${Math.round((app.prefs.sample ?? 1) * 100)}%`;
    $('qualitySelect').value = app.stage.quality;
    // The official 2020 Census count (sum of block populations).
    const pop = app.data.areas.block.pop.reduce((a, b) => a + b, 0);
    $('countyPop').textContent = num.format(pop || 269452);
    this.renderAbout();
    // Address search index loads in the background.
    setTimeout(() => app.ensureAddresses(), 1500);
    this.firstTip = () => this.toast('Type a question at the top, or click any building, road or vehicle to learn about it.', 7000);
  }

  renderAbout() {
    const app = this.app;
    const m = app.data.manifest;
    const ors = app.data.ors;
    const src = (m.sources || []).map((x) => `<li><b>${esc(x.name)}</b>: ${esc(x.use)}</li>`).join('');
    $('about').innerHTML = `
      <h3 class="eyebrow">Asking questions</h3>
      <p>Type a question in the bar at the top, in your own words. The page reads it for places, measures and times it knows, does the
      arithmetic from the data loaded in your browser, and shows the evidence on the map. It is not a chatbot and it does not use the
      internet to answer: if the data can’t answer a question, it says so instead of guessing.</p>
      <p>Every number carries a label: <b>Counted</b> (an actual count, like the 2020 Census), <b>Surveyed</b> (an estimate from a sample
      survey, with a margin of error), <b>Simulated</b> (calculated by this model) or <b>Measured</b> (like elevation or a traffic counter).</p>
      <h3 class="eyebrow">What is real and what is modeled</h3>
      <p>Every road, building and hill is real: OpenStreetMap streets and building outlines on USGS terrain. People are placed in homes so that
      every 2020 Census block adds up to its true count; jobs and commutes follow Census work data. The traffic is simulated: about 780,000 trips
      on a school day follow those commutes, school runs, errands and visitors. Drive times with no traffic are checked against
      openrouteservice (${ors ? Math.round(ors.within_10pct * 100) : 77}% of ${ors ? num.format(ors.pairs) : '8,000'} test trips within 10%).</p>
      <h3 class="eyebrow">Privacy</h3>
      <p>There is no sign-in and nothing to install. Questions you type, your notebook and “my spot” stay in this browser on this device. The
      map reports people only for Census areas, never for a single home.</p>
      <h3 class="eyebrow">Data</h3>
      <ul>${src}</ul>
      <p class="note">Ambulance base locations are approximate. Census 2020 block counts include small random changes that protect privacy.
      Map data © OpenStreetMap contributors, available under the Open Database License. <a href="./teachers.html">Guide for teachers</a> ·
      <a href="./DATA-LICENSE.md">Data sources and license</a></p>`;
  }

  toggleDrawer(open = $('drawer').hidden) {
    $('drawer').hidden = !open;
    $('settingsBtn').setAttribute('aria-expanded', String(open));
  }

  toggleHelp(open) {
    $('help').hidden = !open;
    if (open) $('helpClose').focus();
  }

  syncControls(state) {
    $('playBtn').querySelector('use').setAttribute('href', state.paused ? '#i-play' : '#i-pause');
    $('playBtn').setAttribute('aria-label', state.paused ? 'Resume simulation' : 'Pause simulation');
    for (const b of $('speedSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === state.speed));
    for (const b of $('camSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.cam === state.camera));
    this.weatherMode = state.weather;
    if (this.tab === 'scenario') this.syncWeatherSeg();
    for (const b of $('dockWeather').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.weather === state.weather));
  }

  showLoader(step, frac) {
    const l = $('loader');
    l.hidden = false;
    l.classList.remove('done');
    if (step) $('loaderStep').textContent = step;
    if (frac !== undefined) $('loaderBar').style.width = `${Math.round(frac * 100)}%`;
  }

  hideLoader() {
    const l = $('loader');
    $('loaderBar').style.width = '100%';
    l.classList.add('done');
    setTimeout(() => {
      if (l.classList.contains('done')) l.hidden = true;
    }, 600);
  }

  toast(text, ms = 3600) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      t.hidden = true;
    }, ms);
  }

  /** Small readout under the cursor: the active layer's value, or the drive time. */
  hover(h) {
    let el = this._tip;
    if (!el) {
      el = document.createElement('div');
      el.className = 'tip';
      document.body.appendChild(el);
      this._tip = el;
    }
    const app = this.app;
    if (!h) {
      el.hidden = true;
      return;
    }
    let html = '';
    const heat = app.overlays.heat;
    if (heat) {
      const net = app.net;
      const node = net.nearestNode(h.x, h.z, (n) => net.nodeRank[n] >= 1, 400);
      if (node >= 0 && heat.times[node] < Infinity) {
        const t = heat.times[node] + Math.hypot(net.nodeX[node] - h.x, net.nodeZ[node] - h.z) * 1.4 / 6;
        const what = app.coverage ? (app.coverage.kind === 'hospital' ? 'to the nearest ER' : 'from the 911 call') : app.driveMap?.from ? 'from here' : `to ${app.driveMap?.target?.name || 'here'}`;
        html = `<b>${fmtMin(t)}</b> ${esc(what)}`;
      }
    } else if (app.overlays.metric) {
      const lg = app.overlays.legend;
      const m = lg.metric;
      const a = app.overlays.areaAt(h.x, h.z);
      const unit = a[m.geo] ?? -1;
      if (unit >= 0) {
        const src = app.data.areas[m.geo];
        const v = src[m.id][unit];
        const where = areaName(m.geo, src, unit);
        html = `<b>${formatValue(v, m.unit)}</b> ${esc(m.label.toLowerCase())}<br><span>${where}</span>`;
      }
    }
    if (!html) {
      el.hidden = true;
      return;
    }
    el.innerHTML = html;
    el.style.left = `${h.cx + 14}px`;
    el.style.top = `${h.cy + 14}px`;
    el.hidden = false;
  }

  renderToolHint() {
    const t = this.app.tool;
    const el = $('toolHint');
    if (!t) {
      el.hidden = true;
      return;
    }
    const text = t.kind === 'call' ? `Click where the ${t.type === 'medical' ? 'medical emergency' : t.type === 'fire' ? 'fire' : t.type === 'crash' ? 'crash' : 'police call'} is. Esc cancels.`
      : t.kind === 'station' ? `Click where the new ${t.station === 'ems' ? 'ambulance base' : t.station === 'fire' ? 'fire station' : 'police post'} should go. Esc cancels.`
        : t.kind === 'set-dest' ? 'Click a building, place or spot to make it your destination. Esc cancels.'
          : 'Click a destination on the map. Esc cancels.';
    el.textContent = text;
    el.hidden = false;
  }

  // --- Per-frame ----------------------------------------------------------------------------------------------

  /** Re-render whatever shows the destination after it changes. */
  onDestinationChange() {
    this.renderBoard();
    if (this.tab === 'drive' || this.tab === 'places') this.renderPanel();
    if (this.selection) this.renderInspector(true);
    if (this.app.driveMap && this.driveTarget === 'dest') this.showDrive();
    this.toast(`Destination: ${this.app.dest.name}. Drive times now measure to it.`, 3500);
  }

  /** Show the active data layer on the dock chip and the rail (checked each frame; cheap). */
  syncDataChip() {
    const id = this.app.overlays ? this.app.overlays.metric : null;
    if (id === this._chipMetric) return;
    this._chipMetric = id;
    const m = id ? this.app.overlays.metricById[id] : null;
    $('dataChipLabel').textContent = m ? m.label : 'Map layers';
    $('dataChip').setAttribute('aria-pressed', String(!!m));
    $('dataChip').title = m ? `Showing: ${m.label}. Click to change it.` : 'Map layers: color neighborhoods by Census data';
    $('dataClear').hidden = !m;
    document.querySelector('.rail-btn[data-tab="map"]')?.classList.toggle('has-layer', !!m);
  }

  frame(dt) {
    this.syncDataChip();
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 1) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.tick += dt;
    this.slowTick += dt;
    if (this.tick >= 0.25) {
      this.tick = 0;
      this.renderStatus();
    }
    if (this.slowTick >= 2.5) {
      this.slowTick = 0;
      this.renderBoard();
      if (this.selection && ['vehicle', 'building', 'road', 'incident'].includes(this.selection.kind)) this.renderInspector(false);
      if (this.tab === 'emergency') this.renderIncidents();
    }
  }

  renderStatus() {
    const app = this.app;
    const w = app.world;
    const c = w.clock;
    $('clockTime').textContent = fmtClock(c.t);
    const d = c.date;
    $('clockDay').textContent = d ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : c.weekday || '';
    const wx = w.weather;
    const tempC = wx.temperature ? wx.temperature(c.hour, c) : 15;
    $('weatherLabel').textContent = `${WEATHER_LABEL[wx.kind] || wx.kind}, ${Math.round(tempC * 9 / 5 + 32)}°F`;
    const night = app.atmos.state.night > 0.5;
    const icon = wx.kind === 'clear' || (wx.kind === 'cloudy' && wx.cloud < 0.5) ? (night ? 'i-moon' : 'i-sun') : WEATHER_ICON[wx.kind] || 'i-cloud';
    $('skyIcon').querySelector('use').setAttribute('href', `#${icon}`);
    $('scenarioLabel').textContent = w.scenario ? w.scenario.label : '';
    const slider = $('timeSlider');
    if (document.activeElement !== slider) slider.value = String(Math.floor(c.t / 60) % 1440);
    const st = w.stats();
    const mph = Math.round((st.avgSpeedKmh || 0) * 0.621371);
    $('statCars').textContent = num.format(st.active || 0);
    $('quickCars').textContent = num.format(st.active || 0);
    $('statSpeed').textContent = String(mph);
    $('quickSpeed').textContent = String(mph);
    const delay = st.congestionIndex !== undefined ? Math.max(0, Math.round((st.congestionIndex - 1) * 100)) : Math.round((st.stoppedShare || 0) * 100);
    $('statDelay').textContent = String(delay);
    $('statTrips').textContent = num.format(st.completedToday ?? st.completed ?? 0);
    const pill = $('flowPill');
    const state = delay < 15 ? 'go' : delay < 35 ? 'caution' : 'stop';
    pill.dataset.state = state;
    pill.textContent = state === 'go' ? 'Moving' : state === 'caution' ? 'Busy' : 'Congested';
    $('fps').textContent = `${Math.round(this.fps)} fps`;
    const day = c.dayIndex ?? (d ? d.toDateString() : 0);
    if (this.historyDay !== day) {
      this.historyDay = day;
      this.history = new Array(144).fill(null);
    }
    const slot = Math.min(143, Math.floor((c.t % 86400) / 600));
    if (slot < this.historySlot) this.history.fill(null, slot + 1);
    this.historySlot = slot;
    this.history[slot] = st.active || 0;
    this.drawSpark();
  }

  renderBoard() {
    const rows = this.app.boardTimes();
    const box = $('destTimes');
    box.innerHTML = `<div class="h">Drive to ${esc(destShort(this.app.dest))}, now</div>` + rows.map((r) => {
      const ratio = r.live / r.free;
      const cls = ratio > 1.5 ? 'vslow' : ratio > 1.2 ? 'slow' : '';
      return `<div class="r"><span>${esc(r.label)}</span><b class="${cls}">${fmtMin(r.live)}</b></div>`;
    }).join('');
  }

  drawSpark() {
    const c = $('spark');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(document.documentElement);
    const lane = css.getPropertyValue('--lane').trim() || '#f2c230';
    const edge = css.getPropertyValue('--edge').trim();
    const ink3 = css.getPropertyValue('--ink-3').trim();
    const vals = this.history.filter((v) => v !== null);
    const max = Math.max(10, ...vals) * 1.1;
    const x = (i) => (i / 144) * (W - 4) + 2;
    const y = (v) => H - 12 - (v / max) * (H - 16);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.fillStyle = ink3;
    ctx.font = '9px "Overpass Mono", ui-monospace, monospace';
    ctx.textBaseline = 'bottom';
    for (const [h, label] of [[0, '12a'], [6, '6a'], [12, '12p'], [18, '6p'], [24, '12a']]) {
      const gx = Math.round(x(h * 6)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(gx, 2);
      ctx.lineTo(gx, H - 12);
      ctx.stroke();
      ctx.textAlign = h === 0 ? 'left' : h === 24 ? 'right' : 'center';
      ctx.fillText(label, gx, H);
    }
    ctx.beginPath();
    let started = false;
    this.history.forEach((v, i) => {
      if (v === null) {
        started = false;
        return;
      }
      if (started) ctx.lineTo(x(i), y(v));
      else ctx.moveTo(x(i), y(v));
      started = true;
    });
    ctx.strokeStyle = lane;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    const nowI = ((this.app.world.clock.t % 86400) / 86400) * 144;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x(nowI)) + 0.5, 2);
    ctx.lineTo(Math.round(x(nowI)) + 0.5, H - 12);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- Panels ------------------------------------------------------------------------------------------------------

  openTab(tab) {
    this.tab = tab;
    for (const b of document.querySelectorAll('.rail-btn')) b.setAttribute('aria-pressed', String(b.dataset.tab === tab));
    $('panel').hidden = !tab;
    document.body.classList.toggle('panel-open', !!tab);
    if (tab) this.renderPanel();
  }

  renderPanel() {
    const tab = this.tab;
    if (!tab) return;
    const titles = { questions: 'Questions', scenario: 'Day, events and weather', map: 'Map layers', drive: 'Drive times', emergency: 'Emergency response', places: 'Schools and places' };
    $('panelTitle').textContent = titles[tab];
    const body = $('panelBody');
    body.innerHTML = '';
    const lab = this.app.lab;
    if (tab === 'questions' && lab) lab.panelQuestions(body);
    else if (tab === 'scenario') this.panelScenario(body);
    else if (tab === 'map' && lab) lab.panelLayers(body);
    else if (tab === 'map') this.panelMap(body);
    else if (tab === 'drive') this.panelDrive(body);
    else if (tab === 'emergency') this.panelEmergency(body);
    else if (tab === 'places') this.panelPlaces(body);
  }

  panelScenario(body) {
    const app = this.app;
    const w = app.world;
    const list = w.scenarios || [];
    const cur = w.scenario ? w.scenario.id : '';
    body.insertAdjacentHTML('beforeend', `
      <div class="field"><label for="scnSel">Scenario</label>
        <select id="scnSel">${list.map((s) => `<option value="${esc(s.id)}" ${s.id === cur ? 'selected' : ''}>${esc(s.label)}</option>`).join('')}</select></div>
      <p id="scnDesc">${esc(w.scenario ? w.scenario.description : '')}</p>
      <div class="field"><label for="demandRange">Traffic volume <output id="demandOut">${Math.round((w.demand ?? 1) * 100)}%</output></label>
        <input type="range" id="demandRange" min="0.25" max="2" step="0.05" value="${w.demand ?? 1}">
        <p class="note">100% is a typical day for this scenario. Push it up to see where the network breaks first.</p></div>
      <h3 class="eyebrow">Events</h3>
      <div id="eventList" class="field"></div>
      <h3 class="eyebrow">Weather</h3>
      <div class="seg" id="weatherSeg" role="group" aria-label="Weather">
        ${['auto', 'clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'].map((k) => `<button data-weather="${k}" title="${k === 'auto' ? 'Changing weather' : WEATHER_LABEL[k]}"><svg><use href="#${k === 'auto' ? 'i-auto' : WEATHER_ICON[k]}"/></svg><span class="sr-only">${k}</span></button>`).join('')}
      </div>`);
    $('scnSel').addEventListener('change', (e) => app.setScenario(e.target.value));
    $('demandRange').addEventListener('input', (e) => {
      $('demandOut').textContent = `${Math.round(Number(e.target.value) * 100)}%`;
      w.setDemand(Number(e.target.value));
    });
    for (const b of $('weatherSeg').querySelectorAll('button')) b.addEventListener('click', () => app.setWeather(b.dataset.weather));
    this.syncWeatherSeg();
    const ev = $('eventList');
    for (const e of w.events || []) {
      const card = document.createElement('div');
      card.className = 'card';
      const venue = app.data.pois.find((p) => p.kind === 'venue' && p.id === e.venue);
      if (venue) {
        e.venueName = e.venueName || venue.name;
        e.capacity = e.capacity || Math.max(venue.capacity || 0, e.attendance || 0);
      }
      const startH = e.start ?? (e.window ? e.window[0] : undefined);
      const start = startH !== undefined ? fmtClock(startH * (startH < 30 ? 3600 : 1)) : '';
      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <h4>${esc(e.label)}</h4>
          <button class="chip" aria-pressed="${!!e.active}">${e.active ? 'On' : 'Off'}</button>
        </div>
        <div class="meta">${esc(e.venueName || e.venue || '')}${start ? ` · ${e.window ? 'entry from' : 'starts'} ${start}` : ''}</div>
        ${e.note ? `<p class="note">${esc(e.note)}</p>` : ''}
        <div class="field"><label>Attendance <output>${num.format(e.attendance || 0)}</output></label>
          <input type="range" min="${Math.round((e.capacity || e.attendance || 1000) * 0.1)}" max="${e.capacity || Math.max(1000, (e.attendance || 1000) * 1.5)}" step="50" value="${e.attendance || 0}"></div>`;
      const chip = card.querySelector('.chip');
      chip.addEventListener('click', () => {
        w.setEvent(e.id, { active: !e.active });
        chip.setAttribute('aria-pressed', String(!!e.active));
        chip.textContent = e.active ? 'On' : 'Off';
      });
      const rng = card.querySelector('input');
      rng.addEventListener('input', () => {
        card.querySelector('output').textContent = num.format(Number(rng.value));
        w.setEvent(e.id, { attendance: Number(rng.value) });
      });
      ev.append(card);
    }
    if (!(w.events || []).length) ev.innerHTML = '<p class="note">No events in this scenario.</p>';
  }

  syncWeatherSeg() {
    const seg = $('weatherSeg');
    if (!seg) return;
    for (const b of seg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.weather === this.weatherMode));
  }

  panelMap(body) {
    const app = this.app;
    const groups = {};
    for (const m of app.data.areas.metrics) (groups[m.group] ||= []).push(m);
    const st = this.mapState;
    body.insertAdjacentHTML('beforeend', `
      <div class="field"><label for="metricSel">Color the map by</label>
        <select id="metricSel"><option value="">Nothing (plain map)</option>
        ${Object.entries(groups).map(([g, ms]) => `<optgroup label="${esc(g)}">${ms.map((m) => `<option value="${m.id}" ${m.id === st.metric ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</optgroup>`).join('')}
        </select></div>
      <div id="metricInfo"></div>`);
    $('metricSel').addEventListener('change', (e) => {
      st.metric = e.target.value;
      st.lo = null;
      st.hi = null;
      this.applyMetric();
      this.renderMetricInfo();
    });
    this.renderMetricInfo();
    body.insertAdjacentHTML('beforeend', `
      <h3 class="eyebrow">Roads</h3>
      <div class="chips" id="roadMode">
        <button class="chip" data-mode="plain" aria-pressed="${(app.overlays.roadMode || 'plain') === 'plain'}">Plain</button>
        <button class="chip" data-mode="congestion" aria-pressed="${app.overlays.roadMode === 'congestion'}">Live congestion</button>
      </div>
      <p class="note">Congestion colors each direction of every road by how much slower it is than free flow right now.</p>`);
    for (const b of $('roadMode').querySelectorAll('.chip')) {
      b.addEventListener('click', () => {
        app.overlays.setRoadMode(b.dataset.mode);
        for (const o of $('roadMode').querySelectorAll('.chip')) o.setAttribute('aria-pressed', String(o === b));
      });
    }
  }

  renderMetricInfo() {
    const box = $('metricInfo');
    if (!box) return;
    const st = this.mapState;
    const app = this.app;
    if (!st.metric) {
      box.innerHTML = '';
      return;
    }
    if (!app.overlays.legend) this.applyMetric();
    const lg = app.overlays.legend;
    if (!lg) return;
    const m = lg.metric;
    const lo = st.lo ?? lg.min;
    const hi = st.hi ?? lg.max;
    const step = (lg.max - lg.min) / 200 || 1;
    const geo = GEO_LABEL[m.geo] || m.geo;
    box.innerHTML = `
      <h3 class="eyebrow">${esc(m.label)}</h3>
      ${m.def ? `<p>${esc(m.def)}</p>` : ''}
      <p class="note">${esc(m.source)} · ${geo}${m.note ? ` · ${esc(m.note)}` : ''}</p>
      <canvas class="histo" id="histo"></canvas>
      <div class="field"><div class="lbl"><span>Highlight only areas from</span><output id="fOut">${formatValue(lo, m.unit)} – ${formatValue(hi, m.unit)}</output></div>
        <div class="dual"><input type="range" id="fLo" min="${lg.min}" max="${lg.max}" step="${step}" value="${lo}" aria-label="Lowest value">
        <input type="range" id="fHi" min="${lg.min}" max="${lg.max}" step="${step}" value="${hi}" aria-label="Highest value"></div></div>
      <label class="check"><input type="checkbox" id="fBuildings" ${st.buildings ? 'checked' : ''}> Color the buildings too</label>
      <label class="check"><input type="checkbox" id="fBorders" ${st.borders ? 'checked' : ''}> Show area borders</label>
      <div class="field"><label for="fOpacity">Opacity</label><input type="range" id="fOpacity" min="0.2" max="1" step="0.05" value="${st.opacity}"></div>
      <div class="card" id="fSum"></div>`;
    const apply = () => {
      let a = Number($('fLo').value);
      let b = Number($('fHi').value);
      if (a > b) [a, b] = [b, a];
      const full = a <= lg.min + step && b >= lg.max - step;
      st.lo = full ? null : a;
      st.hi = full ? null : b;
      $('fOut').textContent = `${formatValue(a, m.unit)} – ${formatValue(b, m.unit)}`;
      this.applyMetric();
      this.drawHisto();
      this.renderFilterSum();
    };
    $('fLo').addEventListener('input', apply);
    $('fHi').addEventListener('input', apply);
    $('fBuildings').addEventListener('change', (e) => {
      st.buildings = e.target.checked;
      this.applyMetric();
    });
    $('fBorders').addEventListener('change', (e) => {
      st.borders = e.target.checked;
      app.terrain.material.userData.uniforms.uBorders.value = st.borders ? 1 : 0;
    });
    $('fOpacity').addEventListener('input', (e) => {
      st.opacity = Number(e.target.value);
      app.terrain.material.userData.uniforms.uOverlayOpacity.value = st.opacity;
    });
    this.drawHisto();
    this.renderFilterSum();
  }

  applyMetric() {
    const st = this.mapState;
    const app = this.app;
    const filter = st.lo !== null || st.hi !== null ? [st.lo ?? -Infinity, st.hi ?? Infinity] : null;
    app.overlays.setMetric(st.metric || null, { filter, buildings: st.buildings, opacity: st.opacity });
    this.renderLegend();
  }

  renderFilterSum() {
    const lg = this.app.overlays.legend;
    const el = $('fSum');
    if (!el || !lg) return;
    const share = lg.popAll ? lg.popIn / lg.popAll : 0;
    el.innerHTML = `<div class="big-num">${num.format(Math.round(lg.popIn))}<small>residents (${Math.round(share * 100)}%)</small></div>
      <p class="note">live in the highlighted ${lg.metric.geo === 'bg' ? 'block groups' : 'blocks'} (2020 Census).</p>`;
  }

  drawHisto() {
    const c = $('histo');
    const lg = this.app.overlays.legend;
    if (!c || !lg) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = c.clientWidth;
    const H = c.clientHeight;
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
    const ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bins = 30;
    const counts = new Array(bins).fill(0);
    const span = lg.max - lg.min || 1;
    for (const v of lg.values) counts[Math.min(bins - 1, Math.floor(((v - lg.min) / span) * bins))]++;
    const mx = Math.max(...counts, 1);
    const lo = lg.filter ? lg.filter[0] : -Infinity;
    const hi = lg.filter ? lg.filter[1] : Infinity;
    for (let i = 0; i < bins; i++) {
      const v0 = lg.min + (span * i) / bins;
      const v1 = v0 + span / bins;
      const inside = v1 >= lo && v0 <= hi;
      const bin = lg.bins.findIndex((b) => v0 + span / bins / 2 <= b.to);
      ctx.fillStyle = inside ? lg.bins[Math.max(0, bin)].color : 'rgba(255,255,255,0.12)';
      const bh = (counts[i] / mx) * (H - 14);
      ctx.fillRect((i / bins) * W + 0.5, H - 12 - bh, W / bins - 1, bh);
    }
    ctx.fillStyle = 'rgba(160,175,190,0.9)';
    ctx.font = '10px "Overpass Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(formatValue(lg.min, lg.metric.unit), 0, H - 1);
    ctx.textAlign = 'right';
    ctx.fillText(formatValue(lg.max, lg.metric.unit), W, H - 1);
  }

  panelDrive(body) {
    const app = this.app;
    const sel = this.selection;
    const selName = sel && sel.kind === 'poi' ? sel.poi.name : sel && sel.kind === 'building' ? 'the selected building' : null;
    const atFocus = app.dest === app.data.focus;
    body.insertAdjacentHTML('beforeend', `
      <div class="card dest-card"><div class="lbl">Your destination</div><b>${esc(app.dest.name)}</b>
        <p class="note">Every building's drive time, the board at the top right and the routes all measure to this place.</p>
        <div class="btn-row"><button class="action" id="destPick"><svg><use href="#i-target"/></svg><span>Choose on the map</span></button>
        ${atFocus ? '' : '<button class="action" id="destReset"><svg><use href="#i-close"/></svg><span>Back to downtown</span></button>'}</div></div>
      <div class="field"><label for="driveTarget">Drive times to</label>
        <select id="driveTarget">
          <option value="dest" ${this.driveTarget === 'dest' ? 'selected' : ''}>${esc(app.dest.name)} (your destination)</option>
          ${selName ? `<option value="sel" ${this.driveTarget === 'sel' ? 'selected' : ''}>${esc(selName)}</option>` : ''}
          <option value="pick">A spot I click on the map…</option>
          <option value="ed">The nearest emergency room</option>
        </select></div>
      <div class="field"><span class="lbl">Traffic</span>
        <div class="seg" id="basisSeg" role="group" aria-label="Traffic conditions">
          <button data-b="free">Free flow</button><button data-b="am">8 AM</button><button data-b="pm">5:30 PM</button><button data-b="live">Now</button>
        </div>
        <p class="note">Free flow means empty roads. 8 AM and 5:30 PM come from a full simulated school day; Now is the simulation as it is running.</p></div>
      <div class="field"><label for="driveMax">Color up to <output id="driveMaxOut">${this.driveMax} min</output></label>
        <input type="range" id="driveMax" min="10" max="90" step="5" value="${this.driveMax}"></div>
      <div class="btn-row"><button class="action" id="driveShow"><svg><use href="#i-clock"/></svg><span>Show drive-time map</span></button>
        <button class="action" id="driveClear"><svg><use href="#i-close"/></svg><span>Clear</span></button></div>
      <div id="driveStats"></div>`);
    for (const b of $('basisSeg').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.b === this.driveBasis));
      b.addEventListener('click', () => {
        this.driveBasis = b.dataset.b;
        for (const o of $('basisSeg').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
        if (app.driveMap) this.showDrive();
      });
    }
    $('driveTarget').addEventListener('change', (e) => {
      this.driveTarget = e.target.value;
      if (this.driveTarget === 'pick') {
        app.setTool({ kind: 'drive-target' });
        return;
      }
      this.showDrive();
    });
    $('driveMax').addEventListener('input', (e) => {
      this.driveMax = Number(e.target.value);
      $('driveMaxOut').textContent = `${this.driveMax} min`;
      if (app.driveMap) this.showDrive();
    });
    $('driveShow').addEventListener('click', () => this.showDrive());
    $('driveClear').addEventListener('click', () => {
      app.clearDriveMap();
      $('driveStats').innerHTML = '';
    });
    $('destPick').addEventListener('click', () => app.setTool({ kind: 'set-dest' }));
    if ($('destReset')) $('destReset').addEventListener('click', () => app.setDestination(null));
    if ($('orsIso')) $('orsIso').checked = app.routes.items.has('iso-ors');
    if ($('orsIso')) $('orsIso').addEventListener('change', (e) => {
      if (!e.target.checked) {
        app.routes.clear('iso-ors');
        return;
      }
      const rings = (app.data.ors.isochrones && app.data.ors.isochrones.rings) || [];
      const cols = { 10: '#5ce1e6', 15: '#7ed957', 20: '#ffde59', 30: '#ff914d', 45: '#ff5757' };
      for (const r of rings) app.routes.setOutline(`iso-ors-${r.minutes}`, r.polygons, cols[r.minutes] || '#ffffff', { width: 18 });
    });
    if (app.driveMap) this.renderDriveStats();
  }

  showDrive() {
    const app = this.app;
    let target;
    if (this.driveTarget === 'dest') target = app.dest;
    else if (this.driveTarget === 'sel') {
      const s = this.selection;
      if (s && s.kind === 'poi') target = s.poi;
      else if (s && s.kind === 'building') {
        const b = app.data.buildings;
        target = { node: b.node[s.building], x: b.x[s.building], z: b.z[s.building], name: 'Selected building' };
      }
    } else if (this.driveTarget === 'ed') {
      const eds = app.data.pois.filter((p) => p.kind === 'hospital' && p.sub === 'ed');
      const times = app.router.dijkstra(eds.map((p) => p.node), app.weights(this.driveBasis), { reverse: true });
      app.driveMap = { target: { name: 'Nearest emergency room' }, basis: this.driveBasis, times };
      app.overlays.showHeat(times, { maxMinutes: Math.min(this.driveMax, 45), bandMinutes: 5 });
      this.renderLegend();
      this.renderDriveStats();
      return;
    }
    if (!target) {
      this.toast('Select a place first.');
      return;
    }
    app.showDriveMap(target, { basis: this.driveBasis, maxMinutes: this.driveMax, bandMinutes: this.driveMax > 45 ? 10 : 5 });
    this.renderDriveStats();
  }

  renderDriveStats() {
    const app = this.app;
    const el = $('driveStats');
    if (!el || !app.driveMap) return;
    const r = app.reachStats(app.driveMap.times);
    const maxRes = r.total || 1;
    el.innerHTML = `<div class="card"><h4>Within reach of ${esc(app.driveMap.target.name || 'here')}</h4>
      ${r.bands.map((b) => `<div class="field"><div class="lbl"><span>${b.minutes} minutes</span><output>${num.format(Math.round(b.residents))} people · ${num.format(Math.round(b.kids))} ages 5–17</output></div>
        <div class="bar"><i style="width:${(b.residents / maxRes) * 100}%"></i></div></div>`).join('')}
      <p class="note">Residents of Buncombe County by modeled drive time (plus a short driveway allowance).</p></div>`;
  }

  panelEmergency(body) {
    const app = this.app;
    const facts = app.facts || {};
    const cov = app.coverage ? app.coverage.kind : null;
    body.insertAdjacentHTML('beforeend', `
      <h3 class="eyebrow">Call 911</h3>
      <div class="btn-row">
        <button class="action" data-call="medical"><span>Medical</span></button>
        <button class="action" data-call="fire"><span>Fire</span></button>
        <button class="action" data-call="crash"><span>Car crash</span></button>
        <button class="action" data-call="police"><span>Police</span></button>
      </div>
      <p class="note">Pick a call type, then click anywhere. The nearest units by live drive time respond in traffic; medical calls continue to the nearest emergency room.</p>
      <div id="incidentList" class="field"></div>
      <h3 class="eyebrow">Response-time map</h3>
      <div class="chips" id="covChips">
        ${[['fire', 'Fire engine'], ['ems', 'Ambulance'], ['medical', 'First medical responder'], ['police', 'Police'], ['hospital', 'Emergency room']].map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${cov === k}">${l}</button>`).join('')}
        <button class="chip" data-k="" aria-pressed="${!cov}">Off</button>
      </div>
      <div class="seg" id="covBasis" role="group" aria-label="Traffic">
        <button data-b="free" aria-pressed="${!app.coverage || app.coverage.basis === 'free'}">No traffic</button><button data-b="live" aria-pressed="${!!app.coverage && app.coverage.basis === 'live'}">Live traffic</button>
      </div>
      <div id="covStats"></div>
      <h3 class="eyebrow">What if we added a station?</h3>
      <div class="btn-row">
        <button class="action" data-st="fire"><svg><use href="#i-plus"/></svg><span>Fire station</span></button>
        <button class="action" data-st="ems"><svg><use href="#i-plus"/></svg><span>Ambulance base</span></button>
        <button class="action" data-st="police"><svg><use href="#i-plus"/></svg><span>Police post</span></button>
      </div>
      <div id="extraList"></div>
      <div class="card"><p>${esc(facts.ems?.goal || '')}</p><p class="note">${esc(facts.ems?.actual_2016_2022 || '')}</p>
        <p class="note">${esc(facts.nfpa?.note || '')}</p><p class="note">${esc(facts.ems?.bases_note || '')}</p><p class="note">${esc(facts.hospitals || '')}</p></div>`);
    for (const b of body.querySelectorAll('[data-call]')) b.addEventListener('click', () => app.setTool({ kind: 'call', type: b.dataset.call }));
    for (const b of body.querySelectorAll('[data-st]')) b.addEventListener('click', () => app.setTool({ kind: 'station', station: b.dataset.st }));
    const basis = () => ($('covBasis').querySelector('[aria-pressed="true"]') || {}).dataset?.b || 'free';
    for (const b of $('covChips').querySelectorAll('.chip')) {
      b.addEventListener('click', () => {
        for (const o of $('covChips').querySelectorAll('.chip')) o.setAttribute('aria-pressed', String(o === b));
        if (!b.dataset.k) {
          app.clearDriveMap();
          $('covStats').innerHTML = '';
          return;
        }
        this.showCoverage(b.dataset.k, basis());
      });
    }
    for (const b of $('covBasis').querySelectorAll('button')) {
      b.addEventListener('click', () => {
        for (const o of $('covBasis').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
        if (app.coverage) this.showCoverage(app.coverage.kind, b.dataset.b);
      });
    }
    if (app.coverage) this.renderCoverageStats();
    this.renderIncidents();
    this.renderExtras();
  }

  showCoverage(kind, basis) {
    const app = this.app;
    if (kind === 'hospital') {
      const eds = app.data.pois.filter((p) => p.kind === 'hospital' && p.sub === 'ed');
      const times = app.router.dijkstra(eds.map((p) => p.node), app.weights(basis), { reverse: true });
      app.coverage = { kind, basis, times };
      app.overlays.showHeat(times, { maxMinutes: 40, bandMinutes: 5 });
    } else {
      app.showCoverage(kind, basis);
    }
    this.renderLegend();
    this.renderCoverageStats();
  }

  renderCoverageStats() {
    const app = this.app;
    const el = $('covStats');
    if (!el || !app.coverage) return;
    const hosp = app.coverage.kind === 'hospital';
    const th = hosp ? [600, 900, 1200, 1800] : [240, 480, 539, 720];
    const s = app.coverageStats(app.coverage.times, th);
    const label = (sec) => (sec === 539 ? '8:59 (county EMS goal)' : `${Math.round(sec / 60)} min`);
    el.innerHTML = `<div class="card"><h4>${hosp ? 'Drive to the nearest ER' : 'From 911 call to arrival'}</h4>
      ${s.within.map((w) => `<div class="field"><div class="lbl"><span>Within ${label(w.seconds)}</span><output>${Math.round(w.share * 100)}% · ${num.format(Math.round(w.residents))}</output></div>
      <div class="bar"><i style="width:${w.share * 100}%"></i></div></div>`).join('')}
      <p class="note">${hosp ? 'Drive time only.' : 'Includes call processing and turnout; travel uses emergency speeds.'} Share of county residents.</p></div>`;
  }

  renderIncidents() {
    const app = this.app;
    const el = $('incidentList');
    if (!el) return;
    const incs = (app.world.emergency?.incidents || []).slice(-4).reverse();
    el.innerHTML = incs.map((inc) => this.incidentCard(inc)).join('');
    for (const [k, inc] of incs.entries()) {
      const c = el.children[k];
      if (c) c.addEventListener('click', () => app.select({ kind: 'incident', incident: inc }));
    }
  }

  /** Incident times are on the world's monotonic clock; convert to time of day. */
  toClock(t) {
    const w = this.app.world;
    return w.time !== undefined ? w.clock.t - (w.time - t) : t;
  }

  incidentCard(inc) {
    const w = this.app.world;
    const now = w.time !== undefined ? w.time : w.clock.t;
    const tl = (inc.timeline || []).map((e) => `<li class="${e.t <= now ? 'done' : 'next'}"><b>${fmtClock(this.toClock(e.t))}</b><span>${esc(e.label)}</span></li>`).join('');
    const units = (inc.units || []).map((u) => `<li><b>${u.arrived ? 'on scene' : fmtMmSs(u.etaSec)}</b><span>${esc(u.label || u.kind)} · ${esc(u.station || '')}</span></li>`).join('');
    return `<div class="card"><h4>${esc(inc.label || inc.type)}</h4><div class="meta">${esc(inc.status || '')}${inc.responseSec ? ` · first unit ${fmtMmSs(inc.responseSec)} after the call` : ''}</div>
      <ul class="timeline">${units}</ul><ul class="timeline">${tl}</ul></div>`;
  }

  renderExtras() {
    const app = this.app;
    const el = $('extraList');
    if (!el) return;
    if (!app.extraStations.length) {
      el.innerHTML = '<p class="note">Add a hypothetical station, then turn on a response-time map to see how many more people it reaches.</p>';
      return;
    }
    el.innerHTML = `<ul class="list">${app.extraStations.map((s, i) => `<li data-i="${i}"><span>${esc(s.name)}</span><span class="s">remove</span></li>`).join('')}</ul>`;
    for (const li of el.querySelectorAll('li')) {
      li.addEventListener('click', () => {
        app.extraStations.splice(Number(li.dataset.i), 1);
        app.refreshIncidentMarkers();
        if (app.coverage) this.showCoverage(app.coverage.kind, app.coverage.basis);
        this.renderExtras();
      });
    }
  }

  panelPlaces(body) {
    const app = this.app;
    const cats = [['school', 'Schools'], ['college', 'Colleges'], ['hospital', 'Hospitals and ERs'], ['fire', 'Fire stations'], ['ems', 'Ambulance bases'], ['police', 'Police'],
      ['venue', 'Landmarks'], ['hotel', 'Hotels'], ['parking', 'Parking decks']];
    const vis = app.markers.visible;
    body.insertAdjacentHTML('beforeend', `
      <h3 class="eyebrow">Quick looks</h3>
      <div class="chips" id="quickChips">
        <button class="chip" data-q="dest8">Drive to ${esc(destShort(app.dest))} at 8 AM</button>
        <button class="chip" data-q="kids">Where the kids live</button>
        <button class="chip" data-q="fire">Fire response gaps</button>
        <button class="chip" data-q="rush">Rush hour on Hendersonville Rd</button>
        <button class="chip" data-q="tourists">Tourists game night</button>
        <button class="chip" data-q="leaf">Leaf-season Saturday</button>
      </div>
      <h3 class="eyebrow">Show on the map</h3>
      <div class="chips" id="catChips">${cats.map(([k, l]) => `<button class="chip" data-k="${k}" aria-pressed="${vis.has(k)}">${l}</button>`).join('')}</div>
      <h3 class="eyebrow">Go to</h3>
      <div class="chips" id="goChips">${[['Downtown', 0, 0, 4000], ...(app.dest !== app.data.focus ? [[destShort(app.dest), app.dest.x, app.dest.z, 1500]] : []), ['Biltmore Estate', -900, 5200, 4000],
    ['West Asheville', -4300, 1100, 3500], ['North Asheville', -900, -4600, 3500], ['Black Mountain', 20900, -2500, 4000], ['Weaverville', -1100, -11200, 4000],
    ['Arden', 1500, 13800, 4000], ['Swannanoa', 13300, -1000, 4000], ['Candler', -14000, 6500, 5000], ['Whole county', 0, 0, 52000]]
    .map(([l, x, z, d]) => `<button class="chip" data-x="${x}" data-z="${z}" data-d="${d}">${l}</button>`).join('')}</div>
      <h3 class="eyebrow">Schools</h3>
      <div class="chips" id="schoolKind">${['all', 'public', 'charter', 'private'].map((k) => `<button class="chip" data-k="${k}" aria-pressed="${k === (this.schoolKind || 'all')}">${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}</div>
      <ul class="list" id="schoolList"></ul>`);
    for (const b of $('quickChips').querySelectorAll('.chip')) b.addEventListener('click', () => this.quickLook(b.dataset.q));
    for (const b of $('catChips').querySelectorAll('.chip')) {
      b.addEventListener('click', () => {
        const set = new Set(app.markers.visible);
        if (set.has(b.dataset.k)) set.delete(b.dataset.k);
        else set.add(b.dataset.k);
        app.markers.setCategories(set);
        b.setAttribute('aria-pressed', String(set.has(b.dataset.k)));
      });
    }
    for (const b of $('goChips').querySelectorAll('.chip')) b.addEventListener('click', () => app.flyTo(Number(b.dataset.x), Number(b.dataset.z), Number(b.dataset.d), 0.75));
    const renderSchools = () => {
      const kind = this.schoolKind || 'all';
      const list = app.data.pois.filter((p) => p.kind === 'school' && (kind === 'all' || p.sub === kind)).sort((a, b) => a.name.localeCompare(b.name));
      const ul = $('schoolList');
      ul.innerHTML = list.map((p, i) => `<li data-i="${i}"><span>${esc(p.name)}</span><span class="s">${p.enrollment ? num.format(p.enrollment) : ''}</span></li>`).join('');
      for (const li of ul.querySelectorAll('li')) {
        li.addEventListener('click', () => {
          const p = list[Number(li.dataset.i)];
          app.select({ kind: 'poi', poi: p });
          app.flyTo(p.x, p.z, 900, 0.6);
        });
      }
    };
    for (const b of $('schoolKind').querySelectorAll('.chip')) {
      b.addEventListener('click', () => {
        this.schoolKind = b.dataset.k;
        for (const o of $('schoolKind').querySelectorAll('.chip')) o.setAttribute('aria-pressed', String(o === b));
        renderSchools();
      });
    }
    renderSchools();
  }

  /** One-click setups for the views people ask about most. */
  quickLook(q) {
    const app = this.app;
    const w = app.world;
    const dest = app.dest;
    const scen = (id) => (w.scenarios || []).find((s) => s.id === id || s.id.includes(id));
    app.clearDriveMap();
    this.mapState.metric = '';
    app.overlays.setMetric(null);
    if (q === 'dest8') {
      this.driveTarget = 'dest';
      this.driveBasis = 'am';
      this.driveMax = 30;
      app.showDriveMap(dest, { basis: 'am', maxMinutes: 30, bandMinutes: 5 });
      app.setCamera('top');
      app.flyTo(dest.x, dest.z - 2000, 30000);
      this.openTab('drive');
    } else if (q === 'kids') {
      // Highlight roughly the top fifth of block groups.
      const [id, lo] = ['pct_under_18', 0.24];
      this.mapState = { ...this.mapState, metric: id, lo, hi: null, buildings: false };
      app.overlays.setMetric(id, { filter: [lo, Infinity], opacity: this.mapState.opacity });
      app.setCamera('top');
      app.flyTo(1500, 0, 40000);
      this.openTab('map');
    } else if (q === 'fire') {
      this.openTab('emergency');
      this.showCoverage('fire', 'free');
      app.setCamera('top');
      app.flyTo(1500, 0, 48000);
    } else if (q === 'rush') {
      const s = scen('weekday');
      if (s && w.scenario?.id !== s.id) app.setScenario(s.id);
      app.setHour(7.7);
      app.overlays.setRoadMode('congestion');
      if (app.rig.mode === 'top') app.rig.toggleTop(false);
      app.flyTo(1300, 4600, 2600, 0.6);
    } else if (q === 'tourists') {
      const s = scen('tourists') || scen('baseball');
      if (s) app.setScenario(s.id);
      else {
        const ev = (w.events || []).find((e) => e.venue === 'mccormick');
        if (ev) w.setEvent(ev.id, { active: true });
      }
      app.setHour(17.9);
      app.overlays.setRoadMode('congestion');
      const v = app.data.pois.find((p) => p.id === 'mccormick');
      if (app.rig.mode === 'top') app.rig.toggleTop(false);
      if (v) app.flyTo(v.x, v.z, 1800, 0.6);
    } else if (q === 'leaf') {
      const s = scen('leaf') || scen('fall');
      if (s) app.setScenario(s.id);
      app.setHour(13);
      app.overlays.setRoadMode('congestion');
      if (app.rig.mode === 'top') app.rig.toggleTop(false);
      app.flyTo(3500, -1500, 14000, 0.55);
    }
    this.renderLegend();
  }

  // --- Legend ---------------------------------------------------------------------------------------------------------

  renderLegend() {
    const app = this.app;
    const el = $('legend');
    const heat = app.overlays.heat;
    if (heat) {
      const maxMin = heat.maxS / 60;
      const title = app.coverage ? ({ fire: 'Fire engine response', ems: 'Ambulance response', medical: 'First medical responder', police: 'Police response', hospital: 'Drive to the nearest ER' }[app.coverage.kind])
        : `Drive time to ${app.driveMap?.target?.name || 'here'}`;
      const basis = (app.coverage || app.driveMap || {}).basis;
      const bl = { free: 'no traffic', am: 'typical 8 a.m. school day', pm: 'typical 5:30 p.m. school day', live: 'traffic in the simulation right now' }[basis] || '';
      const stops = ['#128c85', '#fbcd4d', '#c7212e', '#59093a'];
      el.innerHTML = `<h4>${esc(title)}</h4><div class="src">${esc(bl)}${app.coverage && app.coverage.kind !== 'hospital' ? ' · includes 911 processing and turnout' : ''}</div>
        <div class="ramp" style="background:linear-gradient(90deg, ${stops[0]}, ${stops[1]} 45%, ${stops[2]} 80%, ${stops[3]})"></div>
        <div class="ticks"><span>0</span><span>${Math.round(maxMin * 0.25)}</span><span>${Math.round(maxMin * 0.5)}</span><span>${Math.round(maxMin * 0.75)}</span><span>${Math.round(maxMin)}+ min</span></div>
        <div class="sum">Lines every ${Math.round(heat.bandS / 60)} minutes.</div>`;
      el.hidden = false;
      return;
    }
    const hl = app.overlays.highlight;
    if (hl) {
      el.innerHTML = `<h4>${esc(hl.label)}</h4><div class="src">${num.format(hl.count)} Census blocks, outlined</div>`;
      el.hidden = false;
      return;
    }
    const lg = app.overlays.legend;
    if (!lg) {
      el.hidden = true;
      return;
    }
    el.innerHTML = `<h4>${esc(lg.metric.label)}</h4><div class="src">${esc(lg.metric.source)}</div>
      <div class="ramp">${lg.bins.map((b) => `<i style="background:${b.color}"></i>`).join('')}</div>
      <div class="ticks"><span>${formatValue(lg.min, lg.metric.unit)}</span><span>${formatValue(lg.bins[3]?.from, lg.metric.unit)}</span><span>${formatValue(lg.max, lg.metric.unit)}</span></div>
      ${lg.filter ? `<div class="sum">Highlighting ${formatValue(lg.filter[0], lg.metric.unit)} – ${formatValue(lg.filter[1], lg.metric.unit)}</div>` : ''}`;
    el.hidden = false;
  }

  // --- Inspector ----------------------------------------------------------------------------------------------------

  select(hit) {
    this.selection = hit;
    const panel = $('inspector');
    if (!hit) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    this.renderInspector(true);
    if (this.tab === 'drive') this.renderPanel();
  }

  rows(list) {
    const dl = $('inspRows');
    dl.innerHTML = '';
    for (const [k, v] of list) {
      if (v === null || v === undefined || v === '') continue;
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      if (typeof v === 'object') dd.innerHTML = v.html;
      else dd.textContent = v;
      dl.append(dt, dd);
    }
  }

  actions(list) {
    const box = $('inspActions');
    box.innerHTML = '';
    for (const a of list) {
      const b = document.createElement('button');
      b.className = 'action';
      b.dataset.action = a.id;
      b.innerHTML = `${a.icon ? `<svg aria-hidden="true"><use href="#${a.icon}"/></svg>` : ''}<span>${a.label}</span>`;
      if (a.pressed !== undefined) b.setAttribute('aria-pressed', String(a.pressed));
      b.addEventListener('click', () => a.run());
      box.append(b);
    }
  }

  areaRows(x, z) {
    const app = this.app;
    const a = app.overlays.areaAt(x, z);
    const out = [];
    if (a.bg >= 0) {
      const bg = app.data.areas.bg;
      const add = (label, id, unit) => {
        const v = bg[id] ? bg[id][a.bg] : null;
        if (v !== null && v !== undefined && Number.isFinite(v)) out.push([label, formatValue(v, unit)]);
      };
      add('People in this Census block group', 'population', 'num');
      add('Median age', 'median_age', 'years');
      add('Under 18', 'pct_under_18', 'pct');
      add('Homes built (median year)', 'median_year_built', 'year');
      add('Homes that are rented', 'pct_renter', 'pct');
      add('Commutes of 30+ minutes', 'pct_commute_30', 'pct');
    }
    return { rows: out, area: a };
  }

  driveBox(times, title = `Drive to ${destShort(this.app.dest)}`) {
    return `<div class="subhead">${esc(title)}</div><dl class="drive-box">
      <div><dt>No traffic</dt><dd>${Math.round(times.free / 60)}<small>min</small></dd></div>
      <div><dt>8 AM weekday</dt><dd>${Math.round(times.am / 60)}<small>min</small></dd></div>
      <div><dt>Right now</dt><dd>${Math.round(times.live / 60)}<small>min</small></dd></div></dl>`;
  }

  addressOf(i) {
    const app = this.app;
    const a = app.addresses;
    if (!a) return '';
    if (!app._bldAddr) {
      app._bldAddr = new Map();
      for (let k = 0; k < a.building.length; k++) if (a.building[k] >= 0 && !app._bldAddr.has(a.building[k])) app._bldAddr.set(a.building[k], k);
    }
    const k = app._bldAddr.get(i);
    return k !== undefined ? a.labels[k] : '';
  }

  renderInspector(rebuild = true) {
    const hit = this.selection;
    if (!hit) return;
    const app = this.app;
    const extra = $('inspExtra');
    if (hit.kind === 'building') {
      const b = app.data.buildings;
      const i = hit.building;
      const k = b.kind[i];
      const addr = hit.address || this.addressOf(i);
      $('inspKind').textContent = KIND_LABEL[k];
      $('inspTitle').textContent = b.name(i) || (addr ? addr.replace(/\s+\d{5}$/, '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : KIND_LABEL[k]);
      $('inspSub').textContent = addr ? `Buncombe County, ZIP ${addr.slice(-5)}` : 'Buncombe County';
      const res = RESIDENTIAL_KINDS.has(k) || b.residents[i] > 0;
      const rows = [];
      if (b.units[i] > 1) rows.push(['Homes in the building', num.format(b.units[i])]);
      if (b.jobs[i] && !RESIDENTIAL_KINDS.has(k)) rows.push(['Jobs (est.)', num.format(b.jobs[i])]);
      const ab = app.data.areas.block;
      const blk = b.block[i];
      if (blk >= 0 && ab.pop[blk] > 0) {
        const kids = ab.pct_kids_b[blk];
        rows.push(['Census block (2020)', `${num.format(ab.pop[blk])} residents · ${num.format(ab.units[blk])} homes${kids !== null && kids !== undefined ? ` · ${Math.round(kids * 100)}% ages 5–17` : ''}`]);
      }
      rows.push(['Size', `${Math.round(b.area[i] * 10.764).toLocaleString('en-US')} sq ft footprint · ${b.floors[i]} ${b.floors[i] === 1 ? 'story' : 'stories'}`]);
      const ar = this.areaRows(b.x[i], b.z[i]);
      this.rows(rows);
      const t = app.destDrive(i);
      let schools = '';
      if (res && rebuild) {
        const zoned = app.zonedSchools(b.block[i]);
        if (zoned.length) {
          schools += `<div class="subhead">Zoned public schools</div><dl class="kv">${zoned.map((z) => `<dt>${z.level}</dt><dd>${esc(z.school.name)}</dd>`).join('')}</dl>`;
        }
        this._schoolsHtml = schools;
      } else if (res) {
        schools = this._schoolsHtml || '';
      }
      extra.innerHTML = (t ? this.driveBox(t) : '') + schools + `<div class="subhead">The neighborhood</div><dl class="kv">${ar.rows.map(([kk, v]) => `<dt>${esc(kk)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        <p class="note">The map reports people for Census areas, never for one home. Zoned schools come from Buncombe County's attendance districts (Asheville City elementary schools are chosen by families).</p>`;
      if (rebuild) {
        this.actions([
          { id: 'route', label: `Route to ${destShort(app.dest)}`, icon: 'i-route', run: () => {
            const r = app.routeToDest(i, 'live');
            if (r) this.toast(`Fastest route right now: ${fmtMin(r.time + app.accessSeconds(i))}, ${(r.length / 1609.34).toFixed(1)} miles.`);
          } },
          { id: 'map', label: 'Drive-time map', icon: 'i-clock', run: () => {
            app.showDriveMap({ node: b.node[i], x: b.x[i], z: b.z[i], name: 'this home' }, { basis: this.driveBasis, from: true, maxMinutes: this.driveMax });
          } },
          { id: 'call', label: 'Call 911', icon: 'i-siren', run: () => {
            const inc = app.call911('medical', b.x[i], b.z[i]);
            if (inc) app.select({ kind: 'incident', incident: inc });
          } },
          { id: 'spot', label: 'Make this my spot', icon: 'i-flag', run: () => {
            const a = this.addressOf(i);
            if (app.lab) app.lab.setMySpot({ x: b.x[i], z: b.z[i], node: b.node[i], label: b.name(i) || (a ? a.replace(/\s+\d{5}$/, '') : 'my spot') });
          } },
          { id: 'ask', label: 'Ask about this area', icon: 'i-ask', run: () => {
            const a = this.addressOf(i);
            if (app.lab) app.lab.askPoint(b.x[i], b.z[i], b.name(i) || (a ? a.replace(/\s+\d{5}$/, '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : 'this building'));
          } },
          { id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() },
        ]);
      }
    } else if (hit.kind === 'poi') {
      const p = hit.poi;
      const kindLabel = { school: p.sub === 'private' ? 'Private school' : p.sub === 'charter' ? 'Charter school' : 'Public school', hospital: p.sub === 'ed' ? 'Emergency department' : p.sub === 'va' ? 'VA medical center' : 'Hospital',
        fire: 'Fire station', ems: 'Ambulance base', police: 'Police', venue: 'Landmark', hotel: 'Hotel', parking: 'Parking', college: 'College', place: 'Place' }[p.kind] || 'Place';
      $('inspKind').textContent = p === app.dest ? `Your destination: ${kindLabel}` : kindLabel;
      $('inspTitle').textContent = p.name;
      $('inspSub').textContent = p.address || p.agency || p.department || p.district || '';
      const grades = (g) => (g === -1 ? 'PK' : g === 0 ? 'K' : String(g));
      const rows = [];
      if (p.kind === 'school') {
        rows.push(['Grades', p.lo !== undefined ? `${grades(p.lo)}–${grades(p.hi)}` : '']);
        rows.push(['Students', p.enrollment ? `${num.format(p.enrollment)}${p.enrollment_source ? ` (${p.enrollment_source})` : ''}` : '']);
      }
      if (p.kind === 'hospital') rows.push(['Emergency care', p.ed || '—'], ['Trauma', p.trauma || '']);
      if (p.apparatus) rows.push(['Apparatus', p.apparatus]);
      if (p.host) rows.push(['Based at', p.host]);
      if (p.approx) rows.push(['Location', { html: '<span class="tag warn">approximate</span>' }]);
      if (p.capacity) rows.push(['Capacity', num.format(p.capacity)]);
      if (p.rooms) rows.push(['Rooms', num.format(p.rooms)]);
      this.rows(rows);
      let html = p.notes ? `<p class="note">${esc(p.notes)}</p>` : '';
      if (p.kind === 'school' || p.kind === 'college' || p === app.dest) {
        const r = app.reachStats(app.timesTo(p.node, 'free'), [15, 30]);
        html += `<div class="subhead">Within reach (no traffic)</div><dl class="kv">${r.bands.map((bb) => `<dt>${bb.minutes} min</dt><dd>${num.format(Math.round(bb.residents))} people · ${num.format(Math.round(bb.kids))} ages 5–17</dd>`).join('')}</dl>`;
      }
      extra.innerHTML = html;
      if (rebuild) {
        const acts = [];
        acts.push({ id: 'drive', label: p.kind === 'fire' || p.kind === 'ems' || p.kind === 'police' ? 'Drive times from here' : 'Drive times to here', icon: 'i-clock', run: () => {
          const from = p.kind === 'fire' || p.kind === 'ems' || p.kind === 'police';
          app.showDriveMap(p, { basis: this.driveBasis, from, maxMinutes: from ? 20 : this.driveMax, bandMinutes: from ? 2 : 5 });
        } });
        if (p.kind === 'venue') {
          const ev = (app.world.events || []).find((e) => e.venue === p.id || e.venueId === p.id);
          if (ev) acts.push({ id: 'event', label: ev.active ? 'Stop the event' : 'Simulate an event here', icon: 'i-calendar', run: () => {
            app.world.setEvent(ev.id, { active: !ev.active });
            this.toast(ev.active ? `${ev.label}: traffic will build before the start.` : `${ev.label} turned off.`);
            this.renderInspector(true);
          } });
        }
        if (app.lab && p.kind !== 'hotel' && p.kind !== 'parking') acts.push({ id: 'ask', label: 'Ask about this place', icon: 'i-ask', run: () => app.lab.askPoi(p) });
        if (p !== app.dest) acts.push({ id: 'dest', label: 'Set as destination', icon: 'i-pin', run: () => app.setDestination(p) });
        acts.push({ id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() });
        this.actions(acts);
      }
    } else if (hit.kind === 'vehicle') {
      const v = hit.vehicle;
      if (v.dead) {
        app.select(null);
        return;
      }
      $('inspKind').textContent = 'Vehicle';
      $('inspTitle').textContent = TYPE_LABEL[v.type] || 'Vehicle';
      $('inspSub').textContent = v.plate ? `NC ${v.plate}` : '';
      const d = app.world.describe ? app.world.describe(v) : null;
      const w = app.world;
      const elapsed = w.time !== undefined ? w.time - (v.departed ?? w.time) : w.clock.t - (v.departed ?? w.clock.t);
      this.rows([
        ['Speed', `${Math.round(v.v * 2.23694)} mph`],
        ['Trip', PURPOSE_LABEL[v.purpose] || v.purpose || ''],
        ['On', app.net.edgeLabel(v.edge)],
        ['Doing', d ? d.status : ''],
        ['Driving for', fmtMin(elapsed)],
        ['Expected', v.expectedSec ? fmtMin(v.expectedSec) + ' without traffic' : ''],
      ]);
      extra.innerHTML = '';
      if (rebuild) {
        this.actions([
          { id: 'follow', label: 'Follow', icon: 'i-car', pressed: app.rig.mode === 'follow' && app.rig.vehicle === v, run: () => app.followSelected() },
          { id: 'drive', label: "Driver's seat", icon: 'i-eye', pressed: app.rig.mode === 'drive' && app.rig.vehicle === v, run: () => app.toggleDrive() },
        ]);
      }
    } else if (hit.kind === 'road') {
      const net = app.net;
      const edges = net.edgesOfGeom(hit.geom);
      const e = edges[0];
      $('inspKind').textContent = 'Road';
      $('inspTitle').textContent = net.edgeLabel(e);
      $('inspSub').textContent = net.classes[net.cls[e]].replace('_link', ' ramp').replace(/^\w/, (c) => c.toUpperCase());
      const rows = [['Speed limit', `${Math.round(net.posted[e] * 0.621371)} mph${net.flags[e] & 16 ? ' (assumed)' : ''}`],
        ['Lanes', edges.map((x) => net.lanes[x]).join(' + ')]];
      for (const x of edges) {
        const r = app.world.congestion ? app.world.congestion[x] : 1;
        const sp = (net.vsim[x] / Math.max(1, r)) * 2.23694;
        rows.push([`${edges.length > 1 ? (net.dir[x] > 0 ? 'One way' : 'Other way') : 'Traffic'} now`, r > 1.05 ? `${Math.round(sp)} mph (${Math.round((r - 1) * 100)}% slower)` : 'Flowing freely']);
      }
      const near = (app.facts?.traffic_counts || []).find((c) => Math.hypot(c.x - hit.x, c.z - hit.z) < 600);
      if (near) rows.push(['NCDOT count nearby', `${num.format(near.aadt)} vehicles/day (${near.year})`]);
      this.rows(rows);
      extra.innerHTML = '';
      if (rebuild) this.actions([{ id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() }]);
    } else if (hit.kind === 'ground') {
      $('inspKind').textContent = 'Location';
      $('inspTitle').textContent = hit.address || 'Open ground';
      const ar = this.areaRows(hit.x, hit.z);
      $('inspSub').textContent = ar.area.block >= 0 ? `Census block ${app.data.areas.block.geoid[ar.area.block]}` : 'Outside Buncombe County';
      this.rows([['Elevation', `${Math.round(app.heightAt(hit.x, hit.z) * 3.281).toLocaleString('en-US')} ft`], ...ar.rows]);
      const node = app.net.nearestNode(hit.x, hit.z, (n) => app.net.nodeRank[n] >= 1);
      const free = app.timesTo(app.dest.node, 'free')[node];
      extra.innerHTML = `<p class="note">About ${fmtMin(free + 60)} from ${esc(app.dest.name)} without traffic.</p>`;
      if (rebuild) {
        this.actions([
          { id: 'call', label: 'Call 911 here', icon: 'i-siren', run: () => {
            const inc = app.call911('medical', hit.x, hit.z);
            if (inc) app.select({ kind: 'incident', incident: inc });
          } },
          { id: 'spot', label: 'Make this my spot', icon: 'i-flag', run: () => { if (app.lab) app.lab.setMySpot({ x: hit.x, z: hit.z, label: hit.address || 'my spot' }); } },
          { id: 'ask', label: 'Ask about this area', icon: 'i-ask', run: () => { if (app.lab) app.lab.askPoint(hit.x, hit.z, hit.address || 'this spot'); } },
          { id: 'dest', label: 'Set as destination', icon: 'i-pin', run: () => app.setDestination(app.placeAt(hit.x, hit.z, hit.address || 'Chosen spot')) },
          { id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() },
        ]);
      }
    } else if (hit.kind === 'incident') {
      const inc = hit.incident;
      $('inspKind').textContent = '911 call';
      $('inspTitle').textContent = inc.label || inc.type;
      $('inspSub').textContent = inc.status || '';
      this.rows([
        ['Called', fmtClock(this.toClock(inc.created ?? app.world.time ?? app.world.clock.t))],
        ['First unit', inc.responseSec ? `${fmtMmSs(inc.responseSec)} after the call` : 'en route'],
        ['Hospital', inc.hospital ? inc.hospital.name || inc.hospital : ''],
        ['Transport', inc.transportEtaSec ? fmtMin(inc.transportEtaSec) : ''],
      ]);
      extra.innerHTML = this.incidentCard(inc);
      if (rebuild) {
        this.actions([
          { id: 'fly', label: 'Fly to', icon: 'i-target', run: () => app.frameSelection() },
          { id: 'follow', label: 'Follow first unit', icon: 'i-car', run: () => {
            const u = (inc.units || []).find((x) => x.vehicle && !x.vehicle.dead);
            if (u) {
              app.select({ kind: 'vehicle', vehicle: u.vehicle });
              app.rig.follow(u.vehicle, app.world);
            }
          } },
        ]);
      }
    }
  }
}

export { SEQ, KIND };

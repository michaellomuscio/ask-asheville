// Field Notebook: the evidence a student collects in the simulation, their own notes, and a
// Claim / Evidence / Reasoning write-up they can print, download or copy.
//
// Everything stays in this browser (localStorage); nothing is sent anywhere and no name is stored.
// The notebook keeps working in memory if storage is unavailable.
//
//   const nb = new Notebook({ capture, toast, onChange, mount });
//   nb.add(card) -> id      nb.count      nb.has(question)
//   nb.open()  nb.close()  nb.toggle()  nb.isOpen
//   nb.remove(id)  nb.cards  nb.reportHtml()  nb.reportText()      (extras)

const KEY = 'ask-asheville:notebook:v1';
const MAX_W = 640;
const JPEG_Q = 0.7;

export const BADGES = {
  counted: { label: 'Counted', tip: 'An actual count, like the 2020 Census.' },
  surveyed: { label: 'Surveyed', tip: 'An estimate from a sample survey; it has a margin of error.' },
  simulated: { label: 'Simulated', tip: 'Calculated by this simulation, a model of the real city.' },
  measured: { label: 'Measured', tip: 'Measured directly, like elevation or a traffic counter.' },
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function badgeHtml(kind) {
  const b = BADGES[kind];
  if (!b) return '';
  return `<span class="nb-badge nb-badge-${kind}" title="${esc(b.tip)}">${b.label}</span>`;
}

const KIND_LABEL = { answer: 'Answer', observation: 'Observation', prediction: 'Prediction' };
const STARTERS = [
  'Where do the most kids live, and why there?',
  'How does a snow day change traffic?',
  'Who lives farthest from an emergency room?',
];
const STEPS = ['question', 'claim', 'evidence', 'reasoning', 'wonder'];
const BADGE_COLOR = { counted: '#127a4a', surveyed: '#1f63b5', simulated: '#7440b8', measured: '#0c7c85' };

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true" ${extra}>${d}</svg>`;
const ICON = {
  book: svg('<path d="M6 3.5h11a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6z"/><path d="M6 3.5v17M3.5 7.5h3M3.5 12h3M3.5 16.5h3M10 8.5h5.5M10 12h5.5"/>'),
  close: svg('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  print: svg('<path d="M7 9V4h10v5"/><rect x="4" y="9" width="16" height="8" rx="1.5"/><path d="M7 14.5h10V20H7z"/>'),
  download: svg('<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>'),
  copy: svg('<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  trash: svg('<path d="M5 7h14M10 7V4.5h4V7M7 7l.8 12.5h8.4L17 7M10.5 10.5v6M13.5 10.5v6"/>'),
  zoom: svg('<path d="M9 4.5H4.5V9M15 4.5h4.5V9M9 19.5H4.5V15M15 19.5h4.5V15"/>'),
  x: svg('<path d="M7 7l10 10M17 7L7 17"/>'),
};

const EMPTY_ART = `<svg class="nb-empty-art" viewBox="0 0 320 120" aria-hidden="true">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path class="nb-art-ink" d="M14 28a10 10 0 0 1 10-10h74a10 10 0 0 1 10 10v30a10 10 0 0 1-10 10H52L36 82V68H24a10 10 0 0 1-10-10z" stroke-width="2"/>
    <path class="nb-art-lane" d="M52 36a9 9 0 1 1 13 8c-3 1.6-4 3.4-4 6" stroke-width="3"/>
    <circle class="nb-art-lane-fill" cx="61" cy="57" r="2.2" stroke="none"/>
    <path class="nb-art-dash" d="M122 46h56" stroke-width="2" stroke-dasharray="2 7"/>
    <path class="nb-art-ink" d="M172 39l8 7-8 7" stroke-width="2"/>
    <rect class="nb-art-card" x="196" y="12" width="110" height="96" rx="9" stroke-width="2"/>
    <path class="nb-art-lane" d="M197 22v76" stroke-width="3"/>
    <rect class="nb-art-pic" x="210" y="24" width="38" height="26" rx="3" stroke-width="1.6"/>
    <path class="nb-art-go" d="M214 45l8-9 6 6 5-5 11 8" stroke-width="1.6"/>
    <path class="nb-art-ink" d="M256 29h38M256 39h26" stroke-width="2"/>
    <path class="nb-art-big" d="M210 64h54" stroke-width="5"/>
    <path class="nb-art-dim" d="M210 78h84M210 88h70M210 98h50" stroke-width="1.6"/>
  </g>
</svg>`;

/** Downscale a data-URL image to at most MAX_W wide JPEG. Resolves '' if it can't be read. */
function shrink(dataUrl) {
  return new Promise((resolve) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      resolve('');
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) {
          resolve('');
          return;
        }
        if (w <= MAX_W && dataUrl.startsWith('data:image/jpeg')) {
          resolve(dataUrl);
          return;
        }
        const k = Math.min(1, MAX_W / w);
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w * k));
        c.height = Math.max(1, Math.round(h * k));
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0b0f14';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', JPEG_Q));
      } catch {
        resolve('');
      }
    };
    img.onerror = () => resolve('');
    img.src = dataUrl;
  });
}

function fmtTime(t) {
  try {
    return new Date(t).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }).replace(',', '');
  } catch {
    return '';
  }
}

function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  return {
    id: str(c.id) || `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
    t: Number(c.t) || Date.now(),
    kind: KIND_LABEL[c.kind] ? c.kind : 'answer',
    question: str(c.question).trim(),
    headline: str(c.headline).trim(),
    detail: str(c.detail).trim(),
    figures: (Array.isArray(c.figures) ? c.figures : []).filter((f) => f && (f.label || f.value !== undefined))
      .map((f) => ({ label: str(f.label), value: str(f.value), badge: BADGES[f.badge] ? f.badge : '' })),
    sources: (Array.isArray(c.sources) ? c.sources : []).map(str).filter(Boolean),
    caveat: str(c.caveat).trim(),
    image: typeof c.image === 'string' && c.image.startsWith('data:image/') ? c.image : '',
    investigation: str(c.investigation).trim(),
    note: str(c.note),
    used: Number(c.used) || 0,
  };
}

export class Notebook {
  constructor({ capture = null, toast = null, onChange = null, mount = null } = {}) {
    this.capture = capture;
    this.toastFn = toast;
    this.onChange = onChange;
    this.mount = mount || document.body;
    this.isOpen = false;
    this.state = { v: 1, cards: [], writeup: { question: '', claim: '', reasoning: '', wonder: '' } };
    this.memoryOnly = false;
    this._told = {};
    this._saveTimer = 0;
    this._statusTimer = 0;
    this._useSeq = 0;
    this._lastFocus = null;
    this._printFrame = null;
    /** Test hook: how a finished report window is printed. */
    this._print = (win) => {
      win.focus();
      win.print();
    };
    this.load();
    this.build();
    this._onDocKey = this._onDocKey.bind(this);
    window.addEventListener('pagehide', () => this.flush());
    window.addEventListener('storage', (e) => {
      // Another tab of the same browser changed the notebook.
      if (e.key !== KEY || this.isOpen) return;
      const before = this.count;
      this.load();
      if (this.count !== before) this._changed();
    });
  }

  // --- Public -------------------------------------------------------------------------------

  get count() {
    return this.state.cards.length;
  }

  /** A copy of the saved cards, newest first. */
  get cards() {
    return this.state.cards.map((c) => ({ ...c, figures: c.figures.map((f) => ({ ...f })), sources: [...c.sources] }));
  }

  has(question) {
    const q = String(question ?? '').trim();
    return !!q && this.state.cards.some((c) => c.question === q);
  }

  add(card = {}) {
    let image = card.image;
    if (image === undefined && this.capture) {
      try {
        image = this.capture() || '';
      } catch {
        image = '';
      }
    }
    const c = cleanCard({ ...card, image, id: undefined, t: Date.now(), note: card.note || '', used: 0 });
    this.state.cards.unshift(c);
    if (c.image) {
      // Store only the downscaled picture; save once it is ready.
      shrink(c.image).then((small) => {
        if (!this.state.cards.includes(c)) return;
        c.image = small;
        this.save();
        this._refreshThumb(c);
      });
    } else {
      this.save();
    }
    if (this.isOpen) this.render();
    this._changed();
    return c.id;
  }

  remove(id) {
    const i = this.state.cards.findIndex((c) => c.id === id);
    if (i < 0) return false;
    this.state.cards.splice(i, 1);
    this.save();
    if (this.isOpen) this.render();
    this._changed();
    return true;
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this._lastFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.render();
    this.el.hidden = false;
    // Let the first frame paint closed so the entrance can animate.
    requestAnimationFrame(() => this.el.classList.add('nb-in'));
    document.addEventListener('keydown', this._onDocKey, true);
    this.win.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.flush();
    this.el.classList.remove('nb-in');
    this.el.hidden = true;
    document.removeEventListener('keydown', this._onDocKey, true);
    if (this._lastFocus && document.contains(this._lastFocus)) this._lastFocus.focus({ preventScroll: true });
    this._lastFocus = null;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  // --- Storage ------------------------------------------------------------------------------

  load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (!o || o.v !== 1) return;
      const w = o.writeup || {};
      this.state = {
        v: 1,
        cards: (Array.isArray(o.cards) ? o.cards : []).map(cleanCard).filter(Boolean),
        writeup: { question: String(w.question || ''), claim: String(w.claim || ''), reasoning: String(w.reasoning || ''), wonder: String(w.wonder || '') },
      };
      this._useSeq = this.state.cards.reduce((m, c) => Math.max(m, c.used || 0), 0);
    } catch {
      // Unreadable or blocked storage: start with an empty notebook.
    }
  }

  _storageWorks() {
    try {
      localStorage.setItem(`${KEY}:probe`, '1');
      localStorage.removeItem(`${KEY}:probe`);
      return true;
    } catch {
      // A completely full store refuses even the probe; if our notebook is in there, storage does work.
      try {
        return localStorage.getItem(KEY) !== null;
      } catch {
        return false;
      }
    }
  }

  /** Write the notebook now. Returns false when it lives only in memory. */
  save() {
    clearTimeout(this._saveTimer);
    this._saveTimer = 0;
    if (this.memoryOnly) return false;
    const write = () => localStorage.setItem(KEY, JSON.stringify(this.state));
    try {
      write();
      return true;
    } catch {
      if (!this._storageWorks()) {
        this.memoryOnly = true;
        this._tellOnce('memory', 'This browser is not saving the notebook, so it lasts only until you close this tab. Print or download it to keep it.');
        return false;
      }
      // Out of room: drop pictures from the oldest cards until it fits.
      const cards = this.state.cards;
      let dropped = false;
      for (let i = cards.length - 1; i >= 0; i--) {
        if (!cards[i].image) continue;
        cards[i].image = '';
        dropped = true;
        this._refreshThumb(cards[i]);
        try {
          write();
          this._tellOnce('quota', 'The notebook is almost full, so the oldest pictures were removed. Your words and numbers are still here.');
          return true;
        } catch {
          // keep dropping
        }
      }
      this._tellOnce(dropped ? 'quota' : 'full', 'The notebook is full and could not be saved. Print or download it, then start over.');
      return false;
    }
  }

  saveSoon() {
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 400);
  }

  flush() {
    if (this._saveTimer) this.save();
  }

  // --- Messages -----------------------------------------------------------------------------

  /** Inside the open notebook the status line speaks; otherwise the app's toast does. */
  say(text) {
    if (this.isOpen && this.status) {
      this.status.textContent = text;
      this.status.classList.add('nb-status-on');
      clearTimeout(this._statusTimer);
      this._statusTimer = setTimeout(() => {
        this.status.classList.remove('nb-status-on');
        this.status.textContent = '';
      }, 5200);
    } else if (this.toastFn) {
      try {
        this.toastFn(text);
      } catch {
        // The app's toast is optional.
      }
    }
  }

  _tellOnce(key, text) {
    if (this._told[key]) return;
    this._told[key] = true;
    this.say(text);
  }

  _changed() {
    if (this.onChange) {
      try {
        this.onChange();
      } catch (err) {
        console.error(err);
      }
    }
  }

  // --- DOM ----------------------------------------------------------------------------------

  build() {
    const el = document.createElement('div');
    el.className = 'nb';
    el.hidden = true;
    el.innerHTML = `
      <div class="nb-backdrop" data-act="close"></div>
      <div class="nb-window" role="dialog" aria-modal="true" aria-labelledby="nb-title" tabindex="-1" data-tab="evidence">
        <header class="nb-head">
          <div class="nb-plate">${ICON.book}<h2 id="nb-title">Field Notebook</h2></div>
          <p class="nb-private">Saved only in this browser on this device.<span class="nb-private-more"> Nothing is sent anywhere.</span></p>
          <button type="button" class="nb-iconbtn nb-close" data-act="close" aria-label="Close the notebook">${ICON.close}</button>
        </header>
        <div class="nb-tabs" role="tablist" aria-label="Notebook sections">
          <button type="button" role="tab" id="nb-tab-evidence" aria-controls="nb-evidence" aria-selected="true" data-tab="evidence">My evidence <span class="nb-count" data-count></span></button>
          <button type="button" role="tab" id="nb-tab-writeup" aria-controls="nb-writeup" aria-selected="false" data-tab="writeup">My write-up <span class="nb-count nb-count-quiet" data-progress-short></span></button>
        </div>
        <div class="nb-cols">
          <section class="nb-col nb-evidence" id="nb-evidence" aria-labelledby="nb-h-evidence">
            <div class="nb-colhead"><h3 id="nb-h-evidence">My evidence</h3><span class="nb-count" data-count></span></div>
            <div class="nb-cards"></div>
          </section>
          <section class="nb-col nb-writeup" id="nb-writeup" aria-labelledby="nb-h-writeup">
            <div class="nb-colhead"><h3 id="nb-h-writeup">My write-up</h3>
              <div class="nb-progress" role="img" aria-label="0 of 5 steps done"><span class="nb-pips">${STEPS.map(() => '<i></i>').join('')}</span><span class="nb-progress-text">0 of 5</span></div>
            </div>
            <ol class="nb-steps">
              <li class="nb-step" data-step="question"><span class="nb-num" aria-hidden="true">1</span>
                <div class="nb-step-body">
                  <label for="nb-w-question">My big question</label>
                  <input type="text" id="nb-w-question" data-w="question" maxlength="240" autocomplete="off" placeholder="What do you want to find out about Asheville?">
                  <div class="nb-starters"><span class="nb-hint">Stuck? Try one:</span>${STARTERS.map((s) => `<button type="button" class="nb-chip" data-starter="${esc(s)}">${esc(s)}</button>`).join('')}</div>
                </div></li>
              <li class="nb-step" data-step="claim"><span class="nb-num" aria-hidden="true">2</span>
                <div class="nb-step-body">
                  <label for="nb-w-claim">My claim</label>
                  <p class="nb-hint" id="nb-h-claim">A claim answers your question in one sentence.</p>
                  <textarea id="nb-w-claim" data-w="claim" rows="2" aria-describedby="nb-h-claim" placeholder="I think that…"></textarea>
                </div></li>
              <li class="nb-step" data-step="evidence"><span class="nb-num" aria-hidden="true">3</span>
                <div class="nb-step-body">
                  <div class="nb-label" id="nb-l-ev">My evidence</div>
                  <div class="nb-evlist" aria-labelledby="nb-l-ev"></div>
                </div></li>
              <li class="nb-step" data-step="reasoning"><span class="nb-num" aria-hidden="true">4</span>
                <div class="nb-step-body">
                  <label for="nb-w-reasoning">My reasoning</label>
                  <p class="nb-hint" id="nb-h-reasoning">Explain how the evidence supports your claim. What else could explain it?</p>
                  <textarea id="nb-w-reasoning" data-w="reasoning" rows="4" aria-describedby="nb-h-reasoning" placeholder="The evidence shows… This supports my claim because…"></textarea>
                </div></li>
              <li class="nb-step" data-step="wonder"><span class="nb-num" aria-hidden="true">5</span>
                <div class="nb-step-body">
                  <label for="nb-w-wonder">What I still wonder</label>
                  <textarea id="nb-w-wonder" data-w="wonder" rows="2" placeholder="A new question this raised for me is…"></textarea>
                </div></li>
            </ol>
          </section>
        </div>
        <footer class="nb-foot">
          <div class="nb-foot-main">
            <button type="button" class="nb-btn nb-btn-primary" data-act="print">${ICON.print}<span class="nb-long">Print or save as PDF</span><span class="nb-short">Print / PDF</span></button>
            <button type="button" class="nb-btn" data-act="download">${ICON.download}<span>Download</span></button>
            <button type="button" class="nb-btn" data-act="copy">${ICON.copy}<span class="nb-long">Copy as text</span><span class="nb-short">Copy text</span></button>
          </div>
          <p class="nb-status" role="status" aria-live="polite"></p>
          <div class="nb-foot-end">
            <button type="button" class="nb-btn nb-btn-quiet" data-act="reset">Start over</button>
            <span class="nb-confirm" hidden><span>Erase every card and all your writing?</span>
              <button type="button" class="nb-btn nb-btn-danger" data-act="reset-yes">Yes, erase</button>
              <button type="button" class="nb-btn" data-act="reset-no">Keep it</button></span>
          </div>
        </footer>
      </div>`;
    this.el = el;
    this.win = el.querySelector('.nb-window');
    this.cardsEl = el.querySelector('.nb-cards');
    this.evList = el.querySelector('.nb-evlist');
    this.status = el.querySelector('.nb-status');

    el.addEventListener('click', (e) => this._onClick(e));
    el.addEventListener('input', (e) => this._onInput(e));
    // Keys typed in the notebook never reach the simulation's shortcuts.
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') this._trapTab(e);
      e.stopPropagation();
    });
    this.mount.appendChild(el);
  }

  _onDocKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    const pending = this.el.querySelector('.nb-confirm:not([hidden]), .nb-card-confirm:not([hidden])');
    if (pending) this._cancelConfirms();
    else this.close();
  }

  _trapTab(e) {
    const items = [...this.win.querySelectorAll('button, input, textarea, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((n) => !n.disabled && n.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === this.win)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && a === last) {
      e.preventDefault();
      first.focus();
    }
  }

  _cancelConfirms() {
    for (const n of this.el.querySelectorAll('.nb-confirm, .nb-card-confirm')) n.hidden = true;
    for (const n of this.el.querySelectorAll('[data-act="reset"], [data-act="remove"]')) n.hidden = false;
  }

  _onClick(e) {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const tab = t.closest('.nb-tabs [data-tab]');
    if (tab) {
      this._setTab(tab.dataset.tab);
      return;
    }
    const starter = t.closest('[data-starter]');
    if (starter) {
      const input = this.el.querySelector('#nb-w-question');
      input.value = starter.dataset.starter;
      this.state.writeup.question = input.value;
      this.saveSoon();
      this._syncWriteup();
      input.focus();
      return;
    }
    const btn = t.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const cardEl = btn.closest('.nb-card');
    const card = cardEl ? this.state.cards.find((c) => c.id === cardEl.dataset.id) : null;
    if (act === 'close') this.close();
    else if (act === 'print') this.print();
    else if (act === 'download') this.download();
    else if (act === 'copy') this.copyText();
    else if (act === 'reset') {
      btn.hidden = true;
      const c = this.el.querySelector('.nb-confirm');
      c.hidden = false;
      c.querySelector('[data-act="reset-no"]').focus();
    } else if (act === 'reset-no') {
      this._cancelConfirms();
      this.el.querySelector('[data-act="reset"]').focus();
    } else if (act === 'reset-yes') {
      this.reset();
    } else if (act === 'zoom' && cardEl) {
      const on = cardEl.classList.toggle('nb-card-zoom');
      btn.setAttribute('aria-expanded', String(on));
      btn.setAttribute('aria-label', on ? 'Make the picture smaller' : 'Make the picture bigger');
    } else if (act === 'use' && card) {
      card.used = card.used ? 0 : ++this._useSeq;
      this.save();
      btn.setAttribute('aria-pressed', String(!!card.used));
      btn.querySelector('span').textContent = card.used ? 'Using as evidence' : 'Use as evidence';
      cardEl.classList.toggle('nb-card-used', !!card.used);
      this._renderEvidence();
    } else if (act === 'unuse') {
      const c = this.state.cards.find((x) => x.id === btn.dataset.id);
      if (c) {
        c.used = 0;
        this.save();
        this.render();
      }
    } else if (act === 'remove' && cardEl) {
      this._cancelConfirms();
      btn.hidden = true;
      const c = cardEl.querySelector('.nb-card-confirm');
      c.hidden = false;
      c.querySelector('[data-act="remove-no"]').focus();
    } else if (act === 'remove-no' && cardEl) {
      this._cancelConfirms();
      cardEl.querySelector('[data-act="remove"]').focus();
    } else if (act === 'remove-yes' && card) {
      this.remove(card.id);
      this.say('Card removed.');
      this.win.focus({ preventScroll: true });
    }
  }

  _onInput(e) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.w) {
      this.state.writeup[t.dataset.w] = t.value;
      this.saveSoon();
      this._syncWriteup();
    } else if (t.classList.contains('nb-note')) {
      const cardEl = t.closest('.nb-card');
      const card = cardEl && this.state.cards.find((c) => c.id === cardEl.dataset.id);
      if (card) {
        card.note = t.value;
        this.saveSoon();
      }
    }
    if (t instanceof HTMLTextAreaElement) this._grow(t);
  }

  _grow(ta) {
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(320, ta.scrollHeight + 2)}px`;
  }

  _setTab(tab) {
    this.win.dataset.tab = tab;
    for (const b of this.el.querySelectorAll('.nb-tabs [data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const cols = this.el.querySelector('.nb-cols');
    cols.scrollTop = 0;
    for (const ta of this.el.querySelectorAll('textarea')) this._grow(ta);
  }

  // --- Rendering ----------------------------------------------------------------------------

  render() {
    const w = this.state.writeup;
    for (const f of this.el.querySelectorAll('[data-w]')) f.value = w[f.dataset.w] || '';
    this._renderCards();
    this._renderEvidence();
    this._syncWriteup();
    this._cancelConfirms();
    requestAnimationFrame(() => {
      for (const ta of this.el.querySelectorAll('textarea')) this._grow(ta);
    });
  }

  _cardHtml(c) {
    const figs = c.figures.map((f) => `<div class="nb-fig"><dt>${esc(f.label)}</dt><dd><span class="nb-fig-val">${esc(f.value)}</span>${badgeHtml(f.badge)}</dd></div>`).join('');
    const noteId = `nb-note-${esc(c.id)}`;
    return `<article class="nb-card nb-kind-${c.kind}${c.used ? ' nb-card-used' : ''}" data-id="${esc(c.id)}">
      <div class="nb-card-top">
        <span class="nb-kind">${KIND_LABEL[c.kind]}</span>
        ${c.investigation ? `<span class="nb-inv">From “${esc(c.investigation)}”</span>` : ''}
        <time class="nb-time" datetime="${new Date(c.t).toISOString()}">${esc(fmtTime(c.t))}</time>
      </div>
      <div class="nb-card-main">
        ${c.image ? `<button type="button" class="nb-thumb" data-act="zoom" aria-expanded="false" aria-label="Make the picture bigger"><img src="${esc(c.image)}" alt="The map as it looked when this was saved"><span class="nb-thumb-zoom">${ICON.zoom}</span></button>` : ''}
        <div class="nb-card-text">
          ${c.question ? `<p class="nb-q">${esc(c.question)}</p>` : ''}
          ${c.headline ? `<p class="nb-headline">${esc(c.headline)}</p>` : ''}
          ${c.detail ? `<p class="nb-detail">${esc(c.detail)}</p>` : ''}
        </div>
      </div>
      ${figs ? `<dl class="nb-figs">${figs}</dl>` : ''}
      ${c.caveat ? `<p class="nb-caveat"><b>Keep in mind:</b> ${esc(c.caveat)}</p>` : ''}
      ${c.sources.length ? `<p class="nb-src"><b>${c.sources.length > 1 ? 'Sources' : 'Source'}:</b> ${c.sources.map(esc).join(' · ')}</p>` : ''}
      <label class="nb-note-label" for="${noteId}">What does this tell you?</label>
      <textarea class="nb-note" id="${noteId}" rows="2" placeholder="Write a note in your own words.">${esc(c.note)}</textarea>
      <div class="nb-card-actions">
        <button type="button" class="nb-btn nb-use" data-act="use" aria-pressed="${!!c.used}">${ICON.check}<span>${c.used ? 'Using as evidence' : 'Use as evidence'}</span></button>
        <button type="button" class="nb-btn nb-btn-quiet nb-remove" data-act="remove">${ICON.trash}<span>Remove</span></button>
        <span class="nb-card-confirm" hidden><span>Remove this card?</span>
          <button type="button" class="nb-btn nb-btn-danger" data-act="remove-yes">Yes, remove</button>
          <button type="button" class="nb-btn" data-act="remove-no">Keep it</button></span>
      </div>
    </article>`;
  }

  _renderCards() {
    const cards = this.state.cards;
    const n = cards.length;
    for (const s of this.el.querySelectorAll('[data-count]')) {
      s.textContent = n ? String(n) : '';
      s.hidden = !n;
    }
    if (!n) {
      this.cardsEl.innerHTML = `<div class="nb-empty">
        ${EMPTY_ART}
        <h4>Your evidence goes here</h4>
        <p>Ask a question about Asheville, then press <b>Save to notebook</b> on the answer. The answer, its numbers and a picture of the map are kept here as a card.</p>
        <ol>
          <li>Collect a few cards that help answer one big question.</li>
          <li>Add a note to each card in your own words.</li>
          <li>Pick the strongest cards as evidence and write up what you found.</li>
        </ol>
      </div>`;
      return;
    }
    this.cardsEl.innerHTML = cards.map((c) => this._cardHtml(c)).join('');
  }

  _refreshThumb(c) {
    if (!this.isOpen) return;
    const cardEl = [...this.cardsEl.querySelectorAll('.nb-card')].find((n) => n.dataset.id === c.id);
    if (!cardEl) return;
    const thumb = cardEl.querySelector('.nb-thumb');
    if (c.image && thumb) thumb.querySelector('img').src = c.image;
    else if (!c.image && thumb) {
      thumb.remove();
      cardEl.classList.remove('nb-card-zoom');
    }
  }

  _usedCards() {
    return this.state.cards.filter((c) => c.used).sort((a, b) => a.used - b.used);
  }

  _renderEvidence() {
    const used = this._usedCards();
    if (!used.length) {
      this.evList.innerHTML = this.count
        ? '<p class="nb-hint nb-evhint">Turn on <b>Use as evidence</b> on the cards that support your claim. They will be listed here.</p>'
        : '<p class="nb-hint nb-evhint">Evidence cards you choose will be listed here. Start by saving an answer to your notebook.</p>';
    } else {
      this.evList.innerHTML = `<ol class="nb-evitems">${used.map((c) => {
        const f = c.figures[0];
        return `<li><div class="nb-ev-text"><b>${esc(c.headline || c.question)}</b>${f ? `<span>${esc(f.label)}: ${esc(f.value)}</span>` : c.question && c.headline ? `<span>${esc(c.question)}</span>` : ''}</div>
          <button type="button" class="nb-iconbtn nb-ev-x" data-act="unuse" data-id="${esc(c.id)}" aria-label="Take this card out of my evidence">${ICON.x}</button></li>`;
      }).join('')}</ol>`;
    }
    this._syncWriteup();
  }

  _stepsDone() {
    const w = this.state.writeup;
    return {
      question: !!w.question.trim(),
      claim: !!w.claim.trim(),
      evidence: this.state.cards.some((c) => c.used),
      reasoning: !!w.reasoning.trim(),
      wonder: !!w.wonder.trim(),
    };
  }

  _syncWriteup() {
    const done = this._stepsDone();
    let n = 0;
    const pips = this.el.querySelectorAll('.nb-pips i');
    STEPS.forEach((s, i) => {
      if (done[s]) n++;
      this.el.querySelector(`.nb-step[data-step="${s}"]`).classList.toggle('nb-step-done', done[s]);
      if (pips[i]) pips[i].classList.toggle('nb-on', done[s]);
    });
    const prog = this.el.querySelector('.nb-progress');
    prog.setAttribute('aria-label', `${n} of 5 steps done`);
    prog.querySelector('.nb-progress-text').textContent = n === 5 ? 'All 5 done' : `${n} of 5`;
    const short = this.el.querySelector('[data-progress-short]');
    short.textContent = `${n}/5`;
    this.el.querySelector('.nb-starters').hidden = done.question;
  }

  // --- Report -------------------------------------------------------------------------------

  _reportSources() {
    const seen = new Set();
    for (const c of this.state.cards) for (const s of c.sources) seen.add(s);
    return [...seen];
  }

  /** A self-contained, light, print-friendly page of the whole notebook. */
  reportHtml() {
    const w = this.state.writeup;
    const used = this._usedCards();
    const rest = this.state.cards.filter((c) => !c.used);
    const block = (text, blankLines) => (text.trim()
      ? `<p class="fill">${esc(text.trim()).replace(/\n/g, '<br>')}</p>`
      : `<div class="blank">${'<i></i>'.repeat(blankLines)}</div>`);
    const card = (c, i) => `<article class="card">
      ${c.image ? `<img src="${esc(c.image)}" alt="Map view">` : ''}
      <div class="body">
        <div class="meta">${i ? `Evidence ${i} · ` : ''}${KIND_LABEL[c.kind]}${c.investigation ? ` · From “${esc(c.investigation)}”` : ''} · ${esc(fmtTime(c.t))}</div>
        ${c.question ? `<p class="q">${esc(c.question)}</p>` : ''}
        ${c.headline ? `<p class="h">${esc(c.headline)}</p>` : ''}
        ${c.detail ? `<p class="d">${esc(c.detail)}</p>` : ''}
        ${c.figures.length ? `<table>${c.figures.map((f) => `<tr><th>${esc(f.label)}</th><td>${esc(f.value)}${f.badge ? ` <span class="b" style="color:${BADGE_COLOR[f.badge]};border-color:${BADGE_COLOR[f.badge]}">${BADGES[f.badge].label}</span>` : ''}</td></tr>`).join('')}</table>` : ''}
        ${c.caveat ? `<p class="s"><b>Keep in mind:</b> ${esc(c.caveat)}</p>` : ''}
        ${c.sources.length ? `<p class="s"><b>${c.sources.length > 1 ? 'Sources' : 'Source'}:</b> ${c.sources.map(esc).join(' · ')}</p>` : ''}
        ${c.note.trim() ? `<p class="n"><b>My note:</b> ${esc(c.note.trim()).replace(/\n/g, '<br>')}</p>` : ''}
      </div></article>`;
    const sources = this._reportSources();
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ask Asheville — Field Notebook</title>
<style>
  *{box-sizing:border-box} html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{margin:0;background:#fff;color:#16202a;font:15px/1.5 "Overpass","Helvetica Neue",Arial,sans-serif}
  main{max-width:780px;margin:0 auto;padding:36px 32px 48px}
  header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;border-bottom:3px solid #0d6b4e;padding-bottom:12px}
  .plate{display:inline-block;background:#0d6b4e;color:#fff;border-radius:7px;padding:3px}
  .plate span{display:block;border:1.5px solid #fff;border-radius:5px;padding:5px 12px 4px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-size:11px}
  h1{margin:8px 0 0;font-size:26px;line-height:1.15;font-weight:800}
  .who{display:grid;gap:10px;font-size:13px;color:#44515e;min-width:230px}
  .who div{display:flex;gap:8px;align-items:flex-end} .who i{flex:1;border-bottom:1px solid #6b7783;height:18px}
  h2{margin:26px 0 6px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0d6b4e;font-weight:800}
  .fill{margin:0;font-size:16px} .fill.big{font-size:20px;font-weight:700;line-height:1.3}
  .blank{display:grid;gap:0} .blank i{display:block;height:30px;border-bottom:1px solid #b9c2cb}
  .card{display:flex;gap:16px;margin:12px 0 0;padding:12px;border:1px solid #c9d1d9;border-left:4px solid #e0b020;border-radius:8px;break-inside:avoid;page-break-inside:avoid}
  .card img{flex:none;width:230px;align-self:flex-start;border-radius:5px;border:1px solid #c9d1d9}
  .card .body{flex:1;min-width:0}
  .meta{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5d6975;font-weight:700}
  .q{margin:4px 0 0;color:#44515e} .h{margin:2px 0 0;font-size:20px;font-weight:800;line-height:1.2} .d{margin:4px 0 0}
  table{border-collapse:collapse;margin:8px 0 0;width:100%;font-size:13.5px}
  th{text-align:left;font-weight:400;color:#44515e;padding:4px 10px 4px 0;border-top:1px dashed #c9d1d9;vertical-align:top}
  td{text-align:right;font-weight:700;padding:4px 0;border-top:1px dashed #c9d1d9;font-variant-numeric:tabular-nums}
  .b{display:inline-block;margin-left:6px;padding:0 6px;border:1px solid;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;vertical-align:1px}
  .s{margin:6px 0 0;font-size:12px;color:#5d6975} .n{margin:8px 0 0;padding:6px 10px;background:#f4f1e4;border-radius:5px}
  .none{color:#5d6975;font-style:italic}
  footer{margin-top:30px;padding-top:12px;border-top:1px solid #c9d1d9;font-size:12px;color:#5d6975}
  footer p{margin:0 0 6px} footer b{color:#16202a}
  @media (max-width:560px){main{padding:22px 16px 32px} header{display:block} .who{margin-top:14px} .card{display:block} .card img{width:100%;margin-bottom:10px}}
  @page{margin:14mm}
  @media print{main{max-width:none;padding:0}}
</style></head><body><main>
<header>
  <div><div class="plate"><span>Ask Asheville</span></div><h1>Field Notebook</h1></div>
  <div class="who"><div>Name <i></i></div><div>Date <i></i></div></div>
</header>
<h2>My big question</h2>
${w.question.trim() ? `<p class="fill big">${esc(w.question.trim())}</p>` : block('', 1)}
<h2>My claim</h2>
${block(w.claim, 2)}
<h2>My evidence</h2>
${used.length ? used.map((c, i) => card(c, i + 1)).join('') : '<p class="none">No cards were marked as evidence yet.</p>'}
<h2>My reasoning</h2>
${block(w.reasoning, 4)}
<h2>What I still wonder</h2>
${block(w.wonder, 2)}
${rest.length ? `<h2>${used.length ? 'Other cards in my notebook' : 'Cards in my notebook'}</h2>${rest.map((c) => card(c, 0)).join('')}` : ''}
<footer>
  <p><b>About this data.</b> Numbers marked Counted are actual counts, like the 2020 Census. Surveyed numbers are estimates from a sample survey and have a margin of error. Measured numbers were measured directly. Simulated numbers were calculated by the Ask Asheville simulation, which is a model of the real city: useful for comparing and explaining, but not an exact record of what happens.</p>
  ${sources.length ? `<p><b>Sources on these cards:</b> ${sources.map(esc).join(' · ')}</p>` : ''}
  <p>Map data © OpenStreetMap contributors. Made with Ask Asheville.</p>
</footer>
</main></body></html>`;
  }

  /** The same notebook as plain text, for pasting into a document. */
  reportText() {
    const w = this.state.writeup;
    const used = this._usedCards();
    const rest = this.state.cards.filter((c) => !c.used);
    const L = [];
    const card = (c, i) => {
      L.push(`${i ? `${i}. ` : '- '}${c.headline || c.question}`);
      if (c.headline && c.question) L.push(`   Question: ${c.question}`);
      if (c.detail) L.push(`   ${c.detail}`);
      for (const f of c.figures) L.push(`   ${f.label}: ${f.value}${f.badge ? ` (${BADGES[f.badge].label.toLowerCase()})` : ''}`);
      if (c.caveat) L.push(`   Keep in mind: ${c.caveat}`);
      if (c.sources.length) L.push(`   Source: ${c.sources.join('; ')}`);
      if (c.note.trim()) L.push(`   My note: ${c.note.trim()}`);
      L.push('');
    };
    L.push('ASK ASHEVILLE: FIELD NOTEBOOK', '');
    L.push('MY BIG QUESTION', w.question.trim() || '(not written yet)', '');
    L.push('MY CLAIM', w.claim.trim() || '(not written yet)', '');
    L.push('MY EVIDENCE');
    if (used.length) used.forEach((c, i) => card(c, i + 1));
    else L.push('(no cards marked as evidence yet)', '');
    L.push('MY REASONING', w.reasoning.trim() || '(not written yet)', '');
    L.push('WHAT I STILL WONDER', w.wonder.trim() || '(not written yet)', '');
    if (rest.length) {
      L.push(used.length ? 'OTHER CARDS IN MY NOTEBOOK' : 'CARDS IN MY NOTEBOOK');
      rest.forEach((c) => card(c, 0));
    }
    L.push('Simulated numbers come from the Ask Asheville simulation, a model of the real city. Map data © OpenStreetMap contributors.');
    return L.join('\n');
  }

  /** Print only the report: it is loaded into a hidden frame and that frame is printed. */
  print() {
    this.flush();
    if (this._printFrame) this._printFrame.remove();
    const frame = document.createElement('iframe');
    frame.className = 'nb-printframe';
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('tabindex', '-1');
    frame.title = 'Notebook report';
    this._printFrame = frame;
    frame.addEventListener('load', async () => {
      const win = frame.contentWindow;
      const doc = frame.contentDocument;
      if (!win || !doc) return;
      try {
        await Promise.all([...doc.images].map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
      } catch {
        // Print anyway.
      }
      win.addEventListener('afterprint', () => setTimeout(() => {
        if (this._printFrame === frame) {
          frame.remove();
          this._printFrame = null;
        }
      }, 500));
      try {
        this._print(win);
      } catch {
        this.say('Printing did not start. Try Download, then print that file.');
      }
    }, { once: true });
    frame.srcdoc = this.reportHtml();
    document.body.appendChild(frame);
    this.say('Opening the print window. Choose “Save as PDF” there to keep a copy.');
  }

  download() {
    this.flush();
    try {
      const blob = new Blob([this.reportHtml()], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      a.href = url;
      a.download = `ask-asheville-notebook-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.html`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.say('Downloaded. The file opens in any browser, even offline.');
    } catch {
      this.say('The download did not start. Try Print or Copy as text.');
    }
  }

  copyText() {
    this.flush();
    const text = this.reportText();
    const ok = () => this.say('Copied. Paste it into a document or an email.');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        this.el.appendChild(ta);
        ta.select();
        const done = document.execCommand('copy');
        ta.remove();
        if (done) ok();
        else this.say('Copying is blocked in this browser. Try Download.');
      } catch {
        this.say('Copying is blocked in this browser. Try Download.');
      }
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }

  /** Erase every card and all writing. */
  reset() {
    const had = this.count;
    this.state = { v: 1, cards: [], writeup: { question: '', claim: '', reasoning: '', wonder: '' } };
    this._useSeq = 0;
    clearTimeout(this._saveTimer);
    this._saveTimer = 0;
    if (!this.memoryOnly) {
      try {
        localStorage.removeItem(KEY);
      } catch {
        // Nothing stored to remove.
      }
    }
    if (this.isOpen) {
      this.render();
      this._setTab('evidence');
      this.win.focus({ preventScroll: true });
    }
    this.say('Notebook cleared. Ready for a new question.');
    if (had) this._changed();
  }
}

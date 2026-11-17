// Small charts for answer cards, drawn as inline SVG so they stay sharp, print cleanly and can be
// read by a screen reader (each has a text description).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const W = 340;

/** Horizontal bars: rows [{label, value, strong}], format(value). */
function bars(c) {
  const rows = c.rows.filter((r) => Number.isFinite(r.value));
  if (!rows.length) return '';
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  const labelW = Math.min(150, Math.max(...rows.map((r) => r.label.length)) * 6.3 + 8);
  const rowH = rows.length > 8 ? 17 : 22;
  const H = rows.length * rowH + 4;
  const barW = W - labelW - 62;
  const body = rows.map((r, i) => {
    const y = i * rowH + 3;
    const w = Math.max(2, (r.value / max) * barW);
    const lab = r.label.length > 24 ? `${r.label.slice(0, 23)}…` : r.label;
    return `<text x="${labelW - 6}" y="${y + rowH / 2 + 1}" class="ch-lab" text-anchor="end">${esc(lab)}</text>
      <rect x="${labelW}" y="${y + 2}" width="${w.toFixed(1)}" height="${rowH - 7}" rx="3" class="${r.strong ? 'ch-bar ch-strong' : 'ch-bar'}"/>
      <text x="${labelW + w + 5}" y="${y + rowH / 2 + 1}" class="ch-val">${esc(c.format(r.value))}</text>`;
  }).join('');
  const desc = rows.map((r) => `${r.label}: ${c.format(r.value)}`).join('; ');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Bar chart. ${desc}`)}">${body}</svg>`;
}

/** Histogram of values with optional marks. */
function histogram(c) {
  const vals = c.values.filter((v) => v !== null && Number.isFinite(v));
  if (vals.length < 5) return '';
  const sorted = [...vals].sort((a, b) => a - b);
  // Trim the far tail so one outlier doesn't flatten the picture.
  const lo = sorted[0];
  const hi = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const n = 24;
  const bins = new Array(n).fill(0);
  const span = hi - lo || 1;
  for (const v of vals) bins[Math.max(0, Math.min(n - 1, Math.floor(((v - lo) / span) * n)))]++;
  const max = Math.max(...bins);
  const H = 84;
  const base = H - 18;
  const bw = W / n;
  const x = (v) => Math.max(0, Math.min(W, ((v - lo) / span) * W));
  const body = bins.map((k, i) => `<rect x="${(i * bw + 0.5).toFixed(1)}" y="${(base - (k / max) * (base - 6)).toFixed(1)}" width="${(bw - 1).toFixed(1)}" height="${((k / max) * (base - 6)).toFixed(1)}" class="ch-bar"/>`).join('');
  const marks = (c.marks || []).map((v, i) => `<line x1="${x(v).toFixed(1)}" x2="${x(v).toFixed(1)}" y1="2" y2="${base}" class="ch-mark"/><circle cx="${x(v).toFixed(1)}" cy="5" r="${i === 0 ? 4 : 3}" class="ch-dot"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Histogram from ${c.format(lo)} to ${c.format(hi)}. ${c.caption || ''}`)}">
    ${body}${marks}<line x1="0" x2="${W}" y1="${base}" y2="${base}" class="ch-axis"/>
    <text x="0" y="${H - 3}" class="ch-tick">${esc(c.format(lo))}</text><text x="${W}" y="${H - 3}" class="ch-tick" text-anchor="end">${esc(c.format(hi))}${hi < sorted[sorted.length - 1] ? '+' : ''}</text>
    <text x="${W / 2}" y="${H - 3}" class="ch-tick" text-anchor="middle">${esc(c.format(sorted[Math.floor(sorted.length / 2)]))} is the middle</text></svg>`;
}

/** Scatter plot with a trend line. */
function scatter(c) {
  const pts = c.pts;
  const H = 210;
  const L = 44; const B = 30; const T = 8; const R = 8;
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs); const x1 = Math.max(...xs); const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  const sx = (v) => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = (v) => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - B - T);
  const dots = pts.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="2.6" class="ch-pt"/>`).join('');
  const clampY = (v) => Math.max(y0, Math.min(y1, v));
  const ya = clampY(c.slope * x0 + c.intercept); const yb = clampY(c.slope * x1 + c.intercept);
  const line = Math.abs(c.r) >= 0.2 ? `<line x1="${sx(x0)}" y1="${sy(ya).toFixed(1)}" x2="${sx(x1)}" y2="${sy(yb).toFixed(1)}" class="ch-trend"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Scatter plot of ${c.yLabel} against ${c.xLabel} for ${pts.length} areas; correlation ${c.r.toFixed(2)}.`)}">
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ch-axis"/><line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" class="ch-axis"/>
    ${dots}${line}
    <text x="${L}" y="${H - B + 12}" class="ch-tick">${esc(c.xFormat(x0))}</text><text x="${W - R}" y="${H - B + 12}" class="ch-tick" text-anchor="end">${esc(c.xFormat(x1))}</text>
    <text x="${L - 4}" y="${H - B}" class="ch-tick" text-anchor="end">${esc(c.yFormat(y0))}</text><text x="${L - 4}" y="${T + 8}" class="ch-tick" text-anchor="end">${esc(c.yFormat(y1))}</text>
    <text x="${(L + W - R) / 2}" y="${H - 3}" class="ch-axlab" text-anchor="middle">${esc(c.xLabel)} →</text>
    <text x="10" y="${(T + H - B) / 2}" class="ch-axlab" text-anchor="middle" transform="rotate(-90 10 ${(T + H - B) / 2})">${esc(c.yLabel)} →</text></svg>`;
}

/** Line over the hours of a day. */
function line(c) {
  const H = 130;
  const L = 46; const B = 28; const T = 8; const R = 8;
  const rows = c.rows;
  const x0 = rows[0].x; const x1 = rows[rows.length - 1].x;
  const y1 = Math.max(...rows.map((r) => r.y)) * 1.05;
  const sx = (v) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v) => H - B - (v / y1) * (H - B - T);
  const d = rows.map((r, i) => `${i ? 'L' : 'M'}${sx(r.x).toFixed(1)} ${sy(r.y).toFixed(1)}`).join(' ');
  const area = `${d} L${sx(x1).toFixed(1)} ${H - B} L${sx(x0).toFixed(1)} ${H - B} Z`;
  const ticks = [3, 6, 9, 12, 15, 18, 21].filter((h) => h >= x0 && h <= x1).map((h) => `<text x="${sx(h).toFixed(1)}" y="${H - B + 12}" class="ch-tick" text-anchor="middle">${esc(c.xFormat(h))}</text><line x1="${sx(h).toFixed(1)}" x2="${sx(h).toFixed(1)}" y1="${T}" y2="${H - B}" class="ch-grid"/>`).join('');
  const mark = c.mark !== undefined ? `<line x1="${sx(c.mark).toFixed(1)}" x2="${sx(c.mark).toFixed(1)}" y1="${T}" y2="${H - B}" class="ch-mark"/>` : '';
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(`Line chart of ${c.yLabel} by ${c.xLabel}.`)}">
    ${ticks}<path d="${area}" class="ch-area"/><path d="${d}" class="ch-line"/>${mark}
    <line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" class="ch-axis"/>
    <text x="${L - 4}" y="${T + 8}" class="ch-tick" text-anchor="end">${esc(c.yFormat(Math.round(y1 / 1000) * 1000))}</text><text x="${L - 4}" y="${H - B}" class="ch-tick" text-anchor="end">0</text>
    <text x="${(L + W - R) / 2}" y="${H - 2}" class="ch-axlab" text-anchor="middle">${esc(c.xLabel)}</text></svg>`;
}

export function chartHtml(c) {
  if (!c) return '';
  const svg = c.type === 'bars' ? bars(c) : c.type === 'histogram' ? histogram(c) : c.type === 'scatter' ? scatter(c) : c.type === 'line' ? line(c) : '';
  return svg ? `<figure class="chart-wrap">${svg}${c.caption ? `<figcaption>${esc(c.caption)}</figcaption>` : ''}</figure>` : '';
}

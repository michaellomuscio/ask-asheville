// Drive the site in headless Chrome for checks and screenshots.
//   node tools/drive.mjs <url> <out-dir> <steps.mjs> [--size 1440x900] [--mobile]
// steps.mjs default-exports async (ctx) => {...}; ctx has ev(js), shot(name), sleep(ms), click(x, y),
// key(text), ready(). Console errors are printed at the end. Chrome is closed through DevTools
// (Browser.close) so it cleans up after itself.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const [url, outDir, stepsFile] = args;
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const [W, H] = opt('size', '1440x900').split('x').map(Number);
const mobile = args.includes('--mobile');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 20000 + Math.floor(Math.random() * 40000);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-'));
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', '--hide-scrollbars', '--mute-audio',
  '--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`,
  `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });

async function closeChrome() {
  if (chrome.exitCode !== null) return;
  const exited = new Promise((r) => chrome.once('exit', r));
  const force = setTimeout(() => { try { chrome.kill('SIGKILL'); } catch { /* gone */ } }, 6000);
  try {
    const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
  } catch { /* fall through to the timer */ }
  await exited;
  clearTimeout(force);
  try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* fine */ }
}

let code = 0;
try {
  let list = null;
  for (let i = 0; i < 100 && !list; i++) { await sleep(150); try { list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); } catch { /* not up yet */ } }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let seq = 0;
  const pending = new Map();
  const errs = [];
  const failed = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('console.error: ' + m.params.args.map((a) => a.value || a.description).join(' '));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('log: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
    else if (m.method === 'Network.loadingFailed' && !m.params.canceled) failed.push(m.params.errorText);
  };
  const send = (method, params) => new Promise((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params: params || {} })); });
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('page: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'jpeg', quality: 82, clip: { x: 0, y: 0, width: W, height: H, scale: 1 }, captureBeyondViewport: true });
    fs.writeFileSync(path.join(outDir, name + '.jpg'), Buffer.from(r.result.data, 'base64'));
  };
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const key = async (text) => { await send('Input.insertText', { text }); };
  const press = async (k) => {
    const codes = { Enter: 13, Escape: 27, Tab: 9 };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code: k, windowsVirtualKeyCode: codes[k] || 0, text: k === 'Enter' ? '\r' : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: codes[k] || 0 });
  };
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send('Page.navigate', { url });
  const ready = async (expr = '!!(window.asheville && window.asheville.world && document.getElementById("loader").hidden)', tries = 900) => {
    for (let i = 0; i < tries; i++) { await sleep(100); try { if (await ev(expr)) return true; } catch { /* page still loading */ } }
    return false;
  };
  const ctx = { ev, shot, sleep, click, key, press, send, ready, errs, W, H };
  const steps = (await import(pathToFileURL(path.resolve(stepsFile)).href)).default;
  await steps(ctx);
  const ue = [...new Set(errs)];
  console.log(ue.length ? 'PAGE ERRORS:\n' + ue.slice(0, 15).join('\n') : 'no page errors', '|', failed.length ? 'failed requests: ' + [...new Set(failed)].join('; ') : 'no failed requests');
  if (ue.length) code = 2;
} catch (e) {
  console.error('DRIVER FAILED', e);
  code = 1;
} finally {
  await closeChrome();
}
process.exit(code);

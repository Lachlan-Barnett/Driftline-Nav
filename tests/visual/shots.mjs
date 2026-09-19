// Takes real screenshots of the running app in headless Chrome/Edge, driving it through the
// DevTools protocol. Useful for eyeballing layout and the canvas, which the fake-DOM tests can't.
//
//   npm run shots                 (desktop + phone sizes, into tests/.shots/)
//   node tests/visual/shots.mjs --only=drive
//
// Needs Chrome or Edge installed. Nothing here is part of the app.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tests', '.shots');
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const only = (process.argv.find(a => a.startsWith('--only=')) || '').split('=')[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browserPath = BROWSERS.find(p => fs.existsSync(p));
if (!browserPath) { console.error('No Chrome/Edge found.'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const vite = await createServer({ root: ROOT, logLevel: 'silent', server: { port: 5199, strictPort: false } });
await vite.listen();
const url = vite.resolvedUrls.local[0];

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftline-shots-'));
const chrome = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=9333',
  `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
async function cdpTarget() {
  for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:9333/json'); const l = await r.json(); const p = l.find(t => t.type === 'page'); if (p) return p; } catch (e) {} await sleep(250); }
  throw new Error('browser did not start');
}
const target = await cdpTarget();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let msgId = 0; const pending = new Map();
ws.onmessage = m => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === 'Runtime.exceptionThrown') console.error('  [page exception]', (d.params.exceptionDetails.exception && d.params.exceptionDetails.exception.description) || d.params.exceptionDetails.text);
  else if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) console.error('  [console.' + d.params.type + ']', d.params.args.map(a => a.value || a.description).join(' ').slice(0, 300));
  else if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') console.error('  [log]', d.params.entry.text, d.params.entry.url || '');
};
const send = (method, params = {}) => new Promise(res => { const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) console.error('page error:', JSON.stringify(r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || r.result.exceptionDetails)); return r.result && r.result.result && r.result.result.value; };
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); console.log('  ' + name + '.png'); }
const searchFor = (text, i = 0) => evalJs(`(() => { const inp = document.getElementById('searchInput'); inp.value = ${JSON.stringify(text)}; inp.dispatchEvent(new Event('input')); const items = document.querySelectorAll('.suggestItem'); items[${i}].click(); return items.length; })()`);
const clickId = id => evalJs(`document.getElementById(${JSON.stringify(id)}).click()`);

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__DRIFTLINE_DEBUG__ = true; try { localStorage.clear(); } catch (e) {}' });

// the first load can trigger Vite's dependency pre-bundling and a reload, so wait for the app itself
async function waitReady() {
  for (let i = 0; i < 120; i++) {
    const ok = await evalJs("!!(window.__driftline && document.getElementById('searchInput'))").catch(() => false);
    if (ok) { await sleep(600); return; }
    await sleep(500);
  }
  console.error('  app never became ready');
}
// wait until the search animation has finished (the route is drawn once it has)
async function waitIdle() {
  await sleep(300);
  for (let i = 0; i < 80; i++) {
    const busy = await evalJs('window.__driftline.state().animRunning').catch(() => true);
    if (!busy) { await sleep(300); return; }
    await sleep(500);
  }
  console.error('  search animation never finished');
}
async function scenario(label, w, h, mobile, steps) {
  if (only && !label.includes(only)) return;
  console.log(label);
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url });
  await waitReady();
  await steps();
}

for (const [tag, w, h, mobile] of [['desktop', 1280, 800, false], ['phone', 390, 844, true]]) {
  await scenario(`${tag}-idle`, w, h, mobile, async () => { await shot(`${tag}-1-idle`); });

  await scenario(`${tag}-preview`, w, h, mobile, async () => {
    await searchFor('toowoomba'); await sleep(5200); await shot(`${tag}-2-preview`);
  });

  await scenario(`${tag}-trip`, w, h, mobile, async () => {
    await searchFor('toowoomba'); await sleep(3500);
    await clickId('addStopBtn'); await searchFor('roma'); await sleep(3500);
    await clickId('addStopBtn'); await searchFor('charleville'); await sleep(6000);
    await shot(`${tag}-3-trip`);
  });

  await scenario(`${tag}-drive`, w, h, mobile, async () => {
    await searchFor('ipswich'); await sleep(4500);
    await clickId('startDrive'); await sleep(2500);
    await shot(`${tag}-4-drive`);
    // pan away so the recentre button appears, above the speed HUD
    await evalJs(`(() => { const c = document.getElementById('map'); const r = c.getBoundingClientRect(); const fire = (t, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: 1, clientX: x, clientY: y, button: 0, bubbles: true, pointerType: 'mouse' })); fire('pointerdown', r.width/2, r.height/2); fire('pointermove', r.width/2 + 90, r.height/2 + 60); fire('pointerup', r.width/2 + 90, r.height/2 + 60); })()`);
    await sleep(400); await shot(`${tag}-5-drive-recentre`);
  });

  // the found route (purple) against the neon-green search lines, close up with the panels hidden
  await scenario(`${tag}-route`, w, h, mobile, async () => {
    await searchFor('toowoomba'); await waitIdle();
    await clickId('addStopBtn'); await searchFor('roma'); await waitIdle();
    await evalJs(`(() => { for (const id of ['previewSheet','tripPanel']) document.getElementById(id).style.display = 'none';
      const g = window.__driftline.graph, a = g.nodes[g.NID['Toowoomba']], b = g.nodes[g.NID['Roma']]; const c = document.getElementById('map'); const r = c.getBoundingClientRect();
      const s = Math.min((r.width-120)/970, (r.height-120)/1200), ox = r.width/2 - 485*s, oy = r.height/2 - 600*s, x = ((a.x+b.x)/2)*s+ox, y = ((a.y+b.y)/2)*s+oy;
      for (let i = 0; i < 9; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: x, clientY: y, bubbles: true, cancelable: true })); })()`);
    await sleep(500); await shot(`${tag}-10-route`);
  });

  // the user marker (red car arrow) close up, idle
  await scenario(`${tag}-user`, w, h, mobile, async () => {
    await evalJs(`(() => { const car = window.__driftline.car(); const c = document.getElementById('map'); const r = c.getBoundingClientRect();
      const s = Math.min((r.width-120)/970, (r.height-120)/1200), ox = r.width/2 - 485*s, oy = r.height/2 - 600*s, x = car.x*s+ox, y = car.y*s+oy;
      for (let i = 0; i < 24; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: x, clientY: y, bubbles: true, cancelable: true })); })()`);
    await sleep(500); await shot(`${tag}-11-user`);
  });

  await scenario(`${tag}-compare`, w, h, mobile, async () => {
    await searchFor('gympie'); await sleep(4500);
    await clickId('compareBtn'); await sleep(400); await shot(`${tag}-6-compare`);
  });

  await scenario(`${tag}-menu`, w, h, mobile, async () => {
    await clickId('menuBtn'); await sleep(500); await shot(`${tag}-7-menu`);
  });

  await scenario(`${tag}-zoom`, w, h, mobile, async () => {
    // zoom in on Brisbane / Browns Plains with real mouse-wheel events
    await evalJs(`(() => { const g = window.__driftline.graph, b = g.places.find(p => p.name === 'Browns Plains'); const c = document.getElementById('map'); const r = c.getBoundingClientRect(); const s = Math.min((r.width-120)/970, (r.height-120)/1200); const ox = r.width/2 - 485*s, oy = r.height/2 - 600*s; const x = b.x*s+ox, y = b.y*s+oy; for (let i = 0; i < 44; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: x, clientY: y, bubbles: true, cancelable: true })); })()`);
    await sleep(500); await shot(`${tag}-8-zoom-brisbane`);
  });
}

if (!only || 'ctx'.includes(only)) {
  console.log('desktop-ctx');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url }); await waitReady();
  await evalJs(`(() => { const c = document.getElementById('map'); c.dispatchEvent(new MouseEvent('contextmenu', { clientX: 880, clientY: 640, bubbles: true, cancelable: true })); })()`);
  await sleep(300); await shot('desktop-9-context-menu');
}

ws.close();
if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F']); else chrome.kill();
await vite.close();
try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
console.log('Screenshots in tests/.shots/');
process.exit(0);

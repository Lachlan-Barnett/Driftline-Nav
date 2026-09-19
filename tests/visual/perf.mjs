// Measures how heavy the app is to draw, in a real headless browser:
//   npm run perf
// For each scene it reports the script time of one full redraw, how many redraws happen per second when nothing
// is going on, and - the number that matters - how much CPU the whole browser uses while the app sits idle
// (drawing, compositing and blurring all count). A headless browser renders in software, so absolute numbers are
// higher than on a real machine: compare runs with each other.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browserPath = process.env.BROWSER_PATH || BROWSERS.find(p => fs.existsSync(p));
if (!browserPath) { console.error('No supported browser found (set BROWSER_PATH).'); process.exit(1); }

const devServer = await createServer({ root: ROOT, logLevel: 'silent', server: { port: 5198, strictPort: false, hmr: false } });
await devServer.listen();
const url = devServer.resolvedUrls.local[0];
const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'driftline-perf-'));
const browser = spawn(browserPath, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', '--remote-debugging-port=9334', `--user-data-dir=${userDir}`, 'about:blank'], { stdio: 'ignore' });
async function target() { for (let i = 0; i < 60; i++) { try { const l = await (await fetch('http://127.0.0.1:9334/json')).json(); const p = l.find(t => t.type === 'page'); if (p) return p; } catch (e) {} await sleep(250); } throw new Error('browser did not start'); }
const ws = new WebSocket((await target()).webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map();
ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evalJs = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };

// a second connection to the browser itself, for per-process CPU time
const version = await (await fetch('http://127.0.0.1:9334/json/version')).json();
const bws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { bws.onopen = res; bws.onerror = rej; });
let bid = 0; const bpending = new Map();
bws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && bpending.has(d.id)) { bpending.get(d.id)(d); bpending.delete(d.id); } };
const cpuSeconds = () => new Promise(res => { const i = ++bid; bpending.set(i, d => res((d.result.processInfo || []).reduce((s, p) => s + p.cpuTime, 0))); bws.send(JSON.stringify({ id: i, method: 'SystemInfo.getProcessInfo' })); });

await send('Page.enable'); await send('Runtime.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__DRIFTLINE_DEBUG__ = true; try { localStorage.clear(); } catch (e) {}' });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let i = 0; i < 120 && !(await evalJs("!!(window.__driftline && document.getElementById('searchInput'))").catch(() => false)); i++) await sleep(500);
await sleep(800);

const zoomTo = (name, wheels) => evalJs(`(() => { const g = window.__driftline.graph; const t = g.places.find(p => p.name === ${JSON.stringify(name)}) || g.nodes[g.NID[${JSON.stringify(name)}]]; const c = document.getElementById('map'); const r = c.getBoundingClientRect(); const s = window.__driftline.state().scale, ox = 0, oy = 0; void ox; void oy;
  const fit = Math.min((r.width-120)/970, (r.height-120)/1200), fx = r.width/2 - 485*fit, fy = r.height/2 - 600*fit; const x = t.x*fit+fx, y = t.y*fit+fy; for (let i = 0; i < ${wheels}; i++) c.dispatchEvent(new WheelEvent('wheel', { deltaY: -1, clientX: x, clientY: y, bubbles: true, cancelable: true })); })()`);
async function measure(label) {
  await sleep(400);
  const ms = await evalJs('(() => { const a = []; for (let i = 0; i < 30; i++) a.push(window.__driftline.renderOnce()); a.sort((x, y) => x - y); return { median: a[15], p90: a[27] }; })()');
  await sleep(1000);
  const before = await evalJs('window.__driftline.renderCount()'), c0 = await cpuSeconds(), t0 = Date.now();
  await sleep(4000);
  const after = await evalJs('window.__driftline.renderCount()'), c1 = await cpuSeconds(), wall = (Date.now() - t0) / 1000;
  console.log(`${label.padEnd(34)} redraw ${ms.median.toFixed(1).padStart(5)} ms   idle: ${((after - before) / wall).toFixed(1).padStart(4)} redraws/s, browser CPU ${(100 * (c1 - c0) / wall).toFixed(0).padStart(3)}% of one core`);
}

console.log('Queensland overview');   await measure('  whole state');
await zoomTo('Brisbane', 14);          await measure('  zoomed in (regional)');
await zoomTo('Brisbane', 16);          await measure('  zoomed in (suburbs, many labels)');
// a route plus a drive
await send('Page.navigate', { url }); await sleep(2500);
for (let i = 0; i < 120 && !(await evalJs("!!(window.__driftline && document.getElementById('searchInput'))").catch(() => false)); i++) await sleep(500);
await evalJs(`(() => { const i = document.getElementById('searchInput'); i.value = 'cairns'; i.dispatchEvent(new Event('input')); document.querySelectorAll('.suggestItem')[0].click(); })()`);
for (let i = 0; i < 60 && (await evalJs('window.__driftline.state().animRunning')); i++) await sleep(500);
console.log('A long route (Brisbane to Cairns)'); await measure('  route on screen, idle');

ws.close(); bws.close();
if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(browser.pid), '/T', '/F']); else browser.kill();
await devServer.close();
try { fs.rmSync(userDir, { recursive: true, force: true }); } catch (e) {}
process.exit(0);

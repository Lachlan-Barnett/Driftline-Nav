// A tiny fake browser for testing the real app code (src/driftline.js) without a browser.
// It loads the app through Vite (so its JSON imports work), gives it a fake DOM, a virtual clock
// (timers, requestAnimationFrame and performance.now all follow `advance(ms)`), and records what
// the canvas is asked to draw.
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let viteServer = null, appModule = null;

async function loadApp() {
  if (!appModule) {
    viteServer = await createServer({ root: ROOT, configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
    appModule = await viteServer.ssrLoadModule('/src/driftline.js');
  }
  return appModule;
}
export async function closeHarness() { if (viteServer) { await viteServer.close(); viteServer = null; appModule = null; } }

const ALG_KEYS = ['bfs', 'dfs', 'ids', 'dijkstra', 'astar', 'ida', 'wave'];

export async function startApp({ prefs, saved, hazards } = {}) {
  const { initDriftline } = await loadApp();
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, setInterval: globalThis.setInterval, clearInterval: globalThis.clearInterval };

  // ---- virtual clock ----
  let now = 0, nextId = 1;
  const timers = new Map();      // id -> { at, fn, every }
  let rafQueue = [];
  const fakeTimers = {
    setTimeout: (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + ms, fn, every: 0 }); return id; },
    setInterval: (fn, ms = 0) => { const id = nextId++; timers.set(id, { at: now + Math.max(1, ms), fn, every: Math.max(1, ms) }); return id; },
    clearTimeout: id => { timers.delete(id); }, clearInterval: id => { timers.delete(id); },
  };

  // ---- fake DOM ----
  const listeners = {};
  const els = {};
  const draw = { texts: [], strokeStyles: {} };
  function ctxStub() {
    const t = {};
    return new Proxy(t, {
      get: (o, k) => k === 'measureText' ? (s => ({ width: String(s).length * 6 }))
        : k === 'fillText' ? ((txt, x, y) => draw.texts.push([String(txt), x, y]))
        : k === 'stroke' ? (() => { draw.strokeStyles[o.strokeStyle] = (draw.strokeStyles[o.strokeStyle] || 0) + 1; })
        : (k in o ? o[k] : () => {}),
      set: (o, k, v) => (o[k] = v, true),
    });
  }
  function makeEl(id) {
    const classes = new Set(); let html = '';
    const el = {
      id, style: { setProperty(k, v) { this[k] = v; }, getPropertyValue(k) { return this[k] || ''; } }, dataset: {}, children: [],
      textContent: '', value: '', placeholder: '', onclick: null, _listeners: {},
      classList: {
        add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c),
        toggle: (c, f) => { const on = f === undefined ? !classes.has(c) : !!f; on ? classes.add(c) : classes.delete(c); return on; },
      },
      get className() { return [...classes].join(' '); }, set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => classes.add(c)); },
      get innerHTML() { return html; }, set innerHTML(v) { html = String(v); },
      addEventListener(type, fn) { (el._listeners[type] = el._listeners[type] || []).push(fn); },
      removeEventListener() {}, setPointerCapture() {}, setAttribute(k, v) { el['attr:' + k] = v; }, getAttribute(k) { return el['attr:' + k]; },
      appendChild(c) { el.children.push(c); }, remove() {}, contains: () => false, closest: () => null,
      focus() { (el._listeners.focus || []).forEach(fn => fn({ target: el })); }, blur() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
      getContext: () => ctxStub(),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    return el;
  }
  const getEl = id => els[id] || (els[id] = makeEl(id));
  const pills = ALG_KEYS.map(k => { const p = makeEl('pill-' + k); p.dataset.alg = k; return p; });
  const documentEl = makeEl('html'); els['html'] = documentEl;
  const doc = {
    getElementById: getEl, createElement: () => makeEl('new'), documentElement: documentEl,
    querySelectorAll: sel => sel === '.algPill' ? pills : [], querySelector: () => null,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); }, removeEventListener() {},
    body: { set innerHTML(v) { app.crashed = String(v).replace(/<[^>]+>/g, ''); }, get innerHTML() { return ''; } },
  };
  const store = {};
  if (prefs) store['driftline_qld_prefs'] = JSON.stringify(prefs);
  if (saved) store['driftline_qld_saved'] = JSON.stringify(saved);
  if (hazards) store['driftline_qld_hazards'] = JSON.stringify(hazards);
  const win = {
    matchMedia: () => ({ matches: false }), addEventListener() {}, removeEventListener() {}, devicePixelRatio: 1, visualViewport: null,
    innerWidth: 1200, innerHeight: 800, __DRIFTLINE_DEBUG__: true,
  };

  const saveGlobals = {};
  const setGlobal = (k, v) => { saveGlobals[k] = Object.getOwnPropertyDescriptor(globalThis, k); Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true }); };
  setGlobal('window', win); setGlobal('document', doc);
  setGlobal('localStorage', { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } });
  setGlobal('requestAnimationFrame', cb => { rafQueue.push(cb); return rafQueue.length; });
  setGlobal('cancelAnimationFrame', () => {});
  setGlobal('getComputedStyle', () => ({ getPropertyValue: () => '#123456' }));
  setGlobal('performance', { now: () => now });
  Object.entries(fakeTimers).forEach(([k, v]) => setGlobal(k, v));

  const app = {
    crashed: null, els, store, draw, win,
    el: getEl,
    // ---- events ----
    // Fire a listener registered with addEventListener. `target` may be a map of selector -> dataset
    // that the fake `closest()` answers, e.g. { '[data-act]': { act: 'up', i: '1' } }.
    fire(id, type, ev = {}, target = {}) {
      const e = { preventDefault() {}, stopPropagation() {}, ...ev, target: { closest: sel => (target[sel] ? { dataset: target[sel], classList: { add() {}, remove() {} } } : null) } };
      const list = (id === 'document' ? listeners[type] : getEl(id)._listeners[type]) || [];
      list.forEach(fn => fn(e));
    },
    click(id, target) { const el = getEl(id); if (el.onclick) el.onclick({ target: el }); this.fire(id, 'click', {}, target); },
    type(text) { getEl('searchInput').value = text; this.fire('searchInput', 'input'); },
    focusSearch() { getEl('searchInput').focus(); },
    pickSuggestion(i = 0) { this.fire('suggestBox', 'click', {}, { '[data-i]': { i: String(i) } }); },
    starSuggestion(i = 0) { this.fire('suggestBox', 'click', {}, { '[data-star]': { star: String(i) } }); },
    pointer(type, x, y, extra = {}) { this.fire('map', type, { pointerId: 1, clientX: x, clientY: y, button: 0, pointerType: 'mouse', ...extra }); },
    // ---- time ----
    advance(ms) {
      const end = now + ms;
      while (now < end) {
        now = Math.min(end, now + 16);
        for (const [id, t] of [...timers]) {
          if (!timers.has(id) || t.at > now) continue;
          if (t.every) t.at = now + t.every; else timers.delete(id);
          t.fn();
        }
        const q = rafQueue; rafQueue = []; q.forEach(cb => cb(now));
      }
    },
    // run until the search animation is over (or give up)
    settle(maxMs = 60000) { for (let t = 0; t < maxMs && this.dbg.state().animRunning; t += 200) this.advance(200); this.advance(100); },
    drive(maxMs = 600000) { for (let t = 0; t < maxMs && this.dbg.state().navActive; t += 200) this.advance(200); },
    get dbg() { return win.__driftline; },
    text(id) { return getEl(id).textContent; },
    html(id) { return getEl(id).innerHTML; },
    has(id, cls) { return getEl(id).classList.contains(cls); },
    stop() {
      cleanup && cleanup();
      Object.entries(saveGlobals).forEach(([k, d]) => { if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k]; });
      Object.entries(real).forEach(([k, v]) => { globalThis[k] = v; });
    },
  };
  const cleanup = initDriftline();
  app.advance(50);
  return app;
}

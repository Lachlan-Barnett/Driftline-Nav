// Shared helpers for the data scripts: on-disk cache, polite HTTP, JSON output formatting.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CACHE_DIR = path.join(ROOT, 'scripts', '.cache');
export const DATA_DIR = path.join(ROOT, 'src', 'data');
export const USER_AGENT = 'driftline-nav-data/1.0 (open-source hobby map; OSM data, ODbL)';
export const FLAGS = new Set(process.argv.slice(2).filter(a => a.startsWith('--')));

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function readCache(name) {
  const p = path.join(CACHE_DIR, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}
export function writeCache(name, data) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(path.join(CACHE_DIR, name), JSON.stringify(data));
}

// Run `fetcher` unless a cached copy exists (pass --refresh to force a re-download).
export async function cached(name, fetcher) {
  if (!FLAGS.has('--refresh')) { const hit = readCache(name); if (hit) { console.log(`  using cached ${name}`); return hit; } }
  console.log(`  downloading ${name} ...`);
  const data = await fetcher();
  writeCache(name, data);
  return data;
}

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
export async function overpass(query, { retries = 4 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    const url = OVERPASS[attempt % OVERPASS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.status === 429 || res.status >= 500) { lastErr = new Error('HTTP ' + res.status); await sleep(4000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } catch (err) { lastErr = err; await sleep(3000 * (attempt + 1)); }
  }
  throw lastErr;
}

// Driving route between two [lon, lat] points from the public OSRM demo server (OSM data).
export async function osrmRoute(a, b, { retries = 4 } = {}) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson&continue_straight=false`;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      const j = await res.json();
      if (j.code === 'Ok' && j.routes && j.routes[0]) {
        const r = j.routes[0];
        return { ok: true, dist: r.distance, dur: r.duration, coords: r.geometry.coordinates };
      }
      return { ok: false, code: j.code };
    } catch (err) { await sleep(2000 * (attempt + 1)); }
  }
  return { ok: false, code: 'NetworkError' };
}

// One row per line keeps the data files readable and diff-friendly.
export function writeRows(file, rows, { open = '[', close = ']' } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, open + '\n' + rows.map(r => '  ' + r).join(',\n') + '\n' + close + '\n');
}
export function writeKeyed(file, entries) { // entries: [key, jsonString]
  writeRows(file, entries.map(([k, v]) => JSON.stringify(k) + ': ' + v), { open: '{', close: '}' });
}

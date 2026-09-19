// Builds src/data/local-roads.json: the local road linking every extra place to the network, with
// its real shape from OSRM (OpenStreetMap data).
//
//   node scripts/fetch-local-roads.mjs [--refresh] [--limit=N]
//
// Every place hangs off its nearest neighbour (a town, or another place): a minimum spanning tree
// grown outward from the towns. Then each link is routed with OSRM. This is ~4,000 requests (about
// 10-15 minutes) and is resumable: progress is saved in scripts/.cache/osrm-local.json.
// Rows are [placeIndex, placeName, parent, shape]: parent is a town name (string) or another
// place's index (number); shape is [[lat, lon], ...] or null when no road could be found.
import fs from 'node:fs';
import path from 'node:path';
import { readCache, writeCache, osrmRoute, sleep, DATA_DIR, writeRows, FLAGS } from './lib/io.mjs';
import { simplify, round4, kmLL } from './lib/geo.mjs';
import { proj } from '../src/projection.js';
import { TOWNS } from '../src/data/network.js';

const CACHE = 'osrm-local.json';
const FETCH_TOL_KM = 0.03, OUTPUT_TOL_KM = 0.08;   // simplify once when fetching, harder when writing
const CONCURRENCY = 3, DELAY_MS = 220;
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? +limitArg.split('=')[1] : Infinity;

console.log('Local roads');
const places = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'places.json'), 'utf8'))
  .map(([name, lat, lon, kind]) => ({ name, lat, lon, kind, ...proj(lat, lon) }));
const towns = TOWNS.map(([name, lat, lon]) => ({ name, lat, lon, ...proj(lat, lon) }));

// ---- minimum spanning tree (Prim), same rule the app used to run at startup ----
const n = places.length, attached = new Uint8Array(n), bestD2 = new Float64Array(n).fill(Infinity), parent = new Array(n);
places.forEach((p, i) => towns.forEach(t => {
  const d2 = (t.x - p.x) ** 2 + (t.y - p.y) ** 2;
  if (d2 < bestD2[i]) { bestD2[i] = d2; parent[i] = { town: t.name }; }
}));
for (let k = 0; k < n; k++) {
  let pick = -1;
  for (let i = 0; i < n; i++) if (!attached[i] && (pick < 0 || bestD2[i] < bestD2[pick])) pick = i;
  attached[pick] = 1;
  for (let i = 0; i < n; i++) {
    if (attached[i]) continue;
    const d2 = (places[i].x - places[pick].x) ** 2 + (places[i].y - places[pick].y) ** 2;
    if (d2 < bestD2[i]) { bestD2[i] = d2; parent[i] = { place: pick }; }
  }
}
const parentPoint = i => parent[i].town !== undefined ? towns.find(t => t.name === parent[i].town) : places[parent[i].place];

// ---- route every link ----
const done = FLAGS.has('--refresh') ? {} : (readCache(CACHE) || {});
const todo = places.map((_, i) => i).filter(i => !done[i]).slice(0, LIMIT);
console.log(`  ${n} places, ${Object.keys(done).length} already routed, ${todo.length} to fetch`);
let finished = 0, failed = 0, next = 0; const started = Date.now();
async function worker() {
  while (next < todo.length) {
    const i = todo[next++], p = places[i], q = parentPoint(i);
    const r = await osrmRoute([q.lon, q.lat], [p.lon, p.lat]);
    const straight = kmLL(q.lat, q.lon, p.lat, p.lon);
    if (r.ok && r.dist / 1000 <= straight * 3.5 + 3) {
      done[i] = { ok: true, dist: Math.round(r.dist), coords: simplify(r.coords.map(([lon, lat]) => [lat, lon]), FETCH_TOL_KM).map(round4) };
    } else { done[i] = { ok: false, code: r.ok ? 'Detour' : r.code }; failed++; }
    finished++;
    if (finished % 100 === 0) {
      writeCache(CACHE, done);
      const rate = finished / ((Date.now() - started) / 1000);
      console.log(`  ${finished}/${todo.length} routed (${failed} without a road), ${rate.toFixed(1)}/s, ~${Math.round((todo.length - finished) / rate / 60)} min left`);
    }
    await sleep(DELAY_MS);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeCache(CACHE, done);

// ---- write the data file ----
const rows = places.map((p, i) => {
  const par = parent[i].town !== undefined ? JSON.stringify(parent[i].town) : parent[i].place;
  const d = done[i];
  const shape = d && d.ok && d.coords.length > 1 ? JSON.stringify(simplify(d.coords, OUTPUT_TOL_KM).map(round4)) : 'null';
  return `[${i},${JSON.stringify(p.name)},${par},${shape}]`;
});
writeRows(path.join(DATA_DIR, 'local-roads.json'), rows);
const withShape = rows.filter(r => !r.endsWith(',null]')).length;
console.log(`  wrote src/data/local-roads.json: ${rows.length} links, ${withShape} with a real road shape`);

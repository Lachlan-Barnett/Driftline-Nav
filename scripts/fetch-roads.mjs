// Builds src/data/roads.json: the real driving shape of every road in src/data/network.js.
//
//   node scripts/fetch-roads.mjs [--refresh]
//
// Each road is routed between its two towns with a public routing service, simplified to ~30 m,
// and written as "TownA|TownB": [[lat, lon], ...], one road per line. Routes are cached in
// scripts/.cache/route-roads.json, so re-running only fetches roads that are new.
import path from 'node:path';
import { readCache, writeCache, routeBetween, sleep, DATA_DIR, writeKeyed, FLAGS } from './lib/io.mjs';
import { simplify, round4, kmLL } from './lib/geo.mjs';
import { TOWNS, ROADS } from '../src/data/network.js';

const CACHE = 'route-roads.json';
const TOL_KM = 0.03;
// Roads the router cannot drive (no drivable road in the data): left as straight lines.
const STRAIGHT = new Set(['Gregory Downs|Camooweal']);

console.log('Road shapes');
const pos = Object.fromEntries(TOWNS.map(([name, lat, lon]) => [name, { lat, lon }]));
const routes = FLAGS.has('--refresh') ? {} : (readCache(CACHE) || {});
let fetched = 0;
for (const [a, b] of ROADS) {
  const key = a + '|' + b;
  if (routes[key] && routes[key].ok) continue;
  routes[key] = await routeBetween([pos[a].lon, pos[a].lat], [pos[b].lon, pos[b].lat]);
  if (++fetched % 10 === 0) { writeCache(CACHE, routes); console.log(`  fetched ${fetched} new routes`); }
  await sleep(350);
}
writeCache(CACHE, routes);

const entries = []; const warnings = [];
let points = 0;
for (const [a, b] of ROADS) {
  const key = a + '|' + b, r = routes[key];
  if (STRAIGHT.has(key) || !r || !r.ok) { warnings.push(`${key}: no drivable route, left straight`); continue; }
  const straight = kmLL(pos[a].lat, pos[a].lon, pos[b].lat, pos[b].lon);
  if (r.dist / 1000 > straight * 1.9) warnings.push(`${key}: road is ${(r.dist / 1000 / straight).toFixed(1)}x the straight line, check it is the road you meant`);
  const pts = simplify(r.coords.map(([lon, lat]) => [lat, lon]), TOL_KM).map(round4);
  points += pts.length;
  entries.push([key, JSON.stringify(pts)]);
}
writeKeyed(path.join(DATA_DIR, 'roads.json'), entries);
console.log(`  wrote src/data/roads.json: ${entries.length} roads, ${points} points`);
warnings.forEach(w => console.log('  note: ' + w));

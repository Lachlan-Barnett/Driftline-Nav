// Builds src/data/roads.json: the real driving shape of every road in src/data/network.js.
//
//   node scripts/fetch-roads.mjs [--refresh]
//
// Each road is routed between its two towns with a public routing service, simplified to ~30 m,
// and written as "TownA|TownB": [[lat, lon], ...], one road per line. It also writes junctions.json (see the end). Routes are cached in
// scripts/.cache/route-roads.json, so re-running only fetches roads that are new.
import fs from 'node:fs';
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

// ---- junctions --------------------------------------------------------------------------------
// Two roads that leave a town along the same road and only then fork (Coen -> Weipa and Coen -> Bamaga share
// 115 km; Brisbane -> Gold Coast and Brisbane -> Beaudesert share 14 km) would make a trip between their far ends
// drive into the town and back out again. So: find where such roads fork, put a junction node there, and cut
// each road into pieces at the junctions; a stretch shared by several roads becomes one piece (one road).
console.log('Junctions');
const MIN_SHARED_KM = 0.4;                                   // shorter shared stretches are not worth a junction
const same = (p, q) => p[0] === q[0] && p[1] === q[1];       // routes over the same road share exact coordinates
const segKm = (p, q) => kmLL(p[1], p[0], q[1], q[0]);
const drivable = ROADS.filter(([a, b]) => { const k = a + '|' + b; return !STRAIGHT.has(k) && routes[k] && routes[k].ok; })
  .map(([a, b]) => ({ key: a + '|' + b, a, b, pts: routes[a + '|' + b].coords }));   // [lon, lat], a -> b
const cuts = new Map(drivable.map(r => [r.key, { a: [], b: [] }]));
for (const T of new Set(TOWNS.map(x => x[0]))) {
  const paths = [];                                          // every road leaving T, as a path outward from T
  for (const r of drivable) { if (r.a === T) paths.push({ r, side: 'a', pts: r.pts }); if (r.b === T) paths.push({ r, side: 'b', pts: r.pts.slice().reverse() }); }
  (function fork(group, start, lastCut) {
    if (group.length < 2) return;
    let k = start;
    while (group.every(p => p.pts[k + 1]) && group.every(p => same(p.pts[k + 1], group[0].pts[k + 1]))) k++;
    let cutAt = lastCut;
    if (k > start) {
      let len = 0; for (let i = lastCut + 1; i <= k; i++) len += segKm(group[0].pts[i - 1], group[0].pts[i]);
      if (len >= MIN_SHARED_KM) { group.forEach(p => cuts.get(p.r.key)[p.side].push(k)); cutAt = k; }
    }
    const buckets = new Map();
    group.forEach(p => { const nx = p.pts[k + 1]; if (!nx) return; const b = nx[0] + ',' + nx[1]; (buckets.get(b) || buckets.set(b, []).get(b)).push(p); });
    buckets.forEach(b => { if (b.length >= 2) fork(b, k, cutAt); });
  })(paths, 0, 0);
}
const junctionAt = new Map(), pieceMap = new Map(), replaced = [];
const townPos = TOWNS.map(([n, lat, lon]) => ({ n, lat, lon }));
const nearestTown = (lat, lon) => townPos.reduce((b, t) => { const d = kmLL(lat, lon, t.lat, t.lon); return d < b.d ? { d, n: t.n } : b; }, { d: Infinity }).n;
const junctionId = pt => {
  const k = pt[0].toFixed(5) + ',' + pt[1].toFixed(5);
  if (!junctionAt.has(k)) junctionAt.set(k, { id: 'J' + (junctionAt.size + 1), lat: +pt[1].toFixed(4), lon: +pt[0].toFixed(4) });
  return junctionAt.get(k).id;
};
for (const r of drivable) {
  const c = cuts.get(r.key), n = r.pts.length;
  const fromA = [...new Set(c.a)].filter(i => i >= 1 && i <= n - 2).sort((x, y) => x - y);
  let fromB = [...new Set(c.b)].map(i => n - 1 - i).filter(i => i >= 1 && i <= n - 2).sort((x, y) => x - y);
  if (fromA.length && fromB.length && fromA[fromA.length - 1] >= fromB[0]) fromB = [];   // the two ends' shared stretches would overlap
  const positions = [...fromA, ...fromB];
  if (!positions.length) continue;
  replaced.push(r.key);
  const bounds = [0, ...positions, n - 1];
  for (let i = 0; i < bounds.length - 1; i++) {
    const from = i === 0 ? r.a : junctionId(r.pts[bounds[i]]), to = i === bounds.length - 2 ? r.b : junctionId(r.pts[bounds[i + 1]]);
    const shape = r.pts.slice(bounds[i], bounds[i + 1] + 1);
    let km = 0; for (let j = 1; j < shape.length; j++) km += segKm(shape[j - 1], shape[j]);
    const id = [from, to].sort().join('|') + '|' + km.toFixed(2);       // the same stretch met from another road
    if (!pieceMap.has(id)) pieceMap.set(id, { from, to, shape: simplify(shape.map(([lon, lat]) => [lat, lon]), TOL_KM).map(round4), owner: r.key });
  }
}
const jrows = [...junctionAt.values()].map(j => JSON.stringify([j.id, j.lat, j.lon, nearestTown(j.lat, j.lon)]));
const prows = [...pieceMap.values()].map(p => JSON.stringify([p.from, p.to, p.shape, p.owner]));
const fileText = '{\n  "junctions": [\n' + jrows.map(r => '    ' + r).join(',\n') + '\n  ],\n  "replaced": ' + JSON.stringify(replaced) + ',\n  "pieces": [\n' + prows.map(r => '    ' + r).join(',\n') + '\n  ]\n}\n';
fs.writeFileSync(path.join(DATA_DIR, 'junctions.json'), fileText);
console.log(`  wrote src/data/junctions.json: ${junctionAt.size} junctions, ${replaced.length} roads cut into ${pieceMap.size} pieces`);

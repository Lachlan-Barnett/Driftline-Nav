// Builds src/data/speeds.json: the signed speed limit of every road in src/data/network.js.
//
//   node scripts/fetch-speeds.mjs [--refresh]
//
// Pulls the named highways from OpenStreetMap with their `maxspeed` tags, matches each way to the
// nearest road of the same name (by the road's real shape), and takes the most common signed
// limit by length. Roads OSM has no limit for get Queensland's 100 km/h default, or 80 km/h when
// they are mostly unsealed. Output: "TownA|TownB": limit, one per line.
import fs from 'node:fs';
import path from 'node:path';
import { cached, overpass, DATA_DIR, writeKeyed } from './lib/io.mjs';
import { kmLL } from './lib/geo.mjs';
import { TOWNS, ROADS } from '../src/data/network.js';

const DEFAULT_LIMIT = 100, UNSEALED_LIMIT = 80;
const MAX_MATCH_KM = 30;      // a way further than this from every road of its name is ignored
const MIN_TAGGED_KM = 8, MIN_TAGGED_SHARE = 0.2;

console.log('Speed limits');
const names = [...new Set(ROADS.map(r => r[3]))].sort();
const raw = await cached('speed-ways.json', () => overpass(
  `[out:json][timeout:170];area["ISO3166-2"="AU-QLD"]->.a;way["highway"]["name"~"^(${names.join('|')})"](area.a);out tags geom;`));

const pos = Object.fromEntries(TOWNS.map(([name, lat, lon]) => [name, { lat, lon }]));
const shapes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'roads.json'), 'utf8'));
const KX = 111.32 * Math.cos(-21.5 * Math.PI / 180), KY = 110.57;
const edges = ROADS.map(([a, b, type, name]) => ({
  key: a + '|' + b, name,
  pts: (shapes[a + '|' + b] || [[pos[a].lat, pos[a].lon], [pos[b].lat, pos[b].lon]]).map(([lat, lon]) => [lon * KX, lat * KY]),
  tagged: {}, taggedKm: 0, totalKm: 0, unpavedKm: 0,
}));
function distToPolylineKm(px, py, pts) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
    let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    m = Math.min(m, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return m;
}
const parseSpeed = v => { const m = /^(\d{2,3})(\s*km\/h)?$/.exec(String(v || '').trim()); return m ? +m[1] : null; };

const byName = new Map();
edges.forEach(e => (byName.get(e.name) || byName.set(e.name, []).get(e.name)).push(e));
let matched = 0, ignored = 0;
for (const w of raw.elements) {
  if (!w.geometry || w.geometry.length < 2) continue;
  const name = w.tags.name.replace(/\s*\(.*\)$/, '');
  const cands = byName.get(name) || byName.get([...byName.keys()].find(k => name.startsWith(k)));
  if (!cands) { ignored++; continue; }
  let lenKm = 0, cx = 0, cy = 0;
  for (let i = 1; i < w.geometry.length; i++) lenKm += kmLL(w.geometry[i - 1].lat, w.geometry[i - 1].lon, w.geometry[i].lat, w.geometry[i].lon);
  w.geometry.forEach(g => { cx += g.lon * KX; cy += g.lat * KY; });
  cx /= w.geometry.length; cy /= w.geometry.length;
  let best = null, bd = Infinity;
  for (const e of cands) { const d = distToPolylineKm(cx, cy, e.pts); if (d < bd) { bd = d; best = e; } }
  if (bd > MAX_MATCH_KM) { ignored++; continue; }
  matched++;
  best.totalKm += lenKm;
  if (/unpaved|gravel|dirt|ground|sand|compacted/.test(w.tags.surface || '')) best.unpavedKm += lenKm;
  const limit = parseSpeed(w.tags.maxspeed);
  if (limit) { best.tagged[limit] = (best.tagged[limit] || 0) + lenKm; best.taggedKm += lenKm; }
}

const out = []; const src = { osm: 0, unsealed: 0, default: 0 };
for (const e of edges) {
  let limit = DEFAULT_LIMIT, from = 'default';
  if (e.taggedKm >= MIN_TAGGED_SHARE * e.totalKm && e.taggedKm > MIN_TAGGED_KM) {
    limit = +Object.entries(e.tagged).sort((x, y) => y[1] - x[1])[0][0]; from = 'osm';
  } else if (e.unpavedKm > e.totalKm * 0.5) { limit = UNSEALED_LIMIT; from = 'unsealed'; }
  src[from]++;
  out.push([e.key, String(limit)]);
}
writeKeyed(path.join(DATA_DIR, 'speeds.json'), out);
console.log(`  matched ${matched} ways (${ignored} ignored). wrote src/data/speeds.json: ${out.length} roads`, src);

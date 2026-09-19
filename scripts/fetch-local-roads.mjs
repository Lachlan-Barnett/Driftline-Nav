// Builds src/data/local-roads.json: how every extra place joins the road network.
//
//   node scripts/fetch-local-roads.mjs [--refresh] [--limit=N]
//
// A place is attached to the main road it is on (or the nearest one), at the real junction:
//   * within ON_ROAD_KM of a main road it simply sits on that road ("on the road", no side road);
//   * otherwise its real street path is fetched from a public routing service and followed back until it
//     first touches a main road: that point is the junction, and the path up to it is the side road.
// Rows are [placeIndex, placeName, junctionLat, junctionLon, sideRoad] where sideRoad is
//   0                      the place is on the road at that point
//   [[lat, lon], ...]      the side road from the junction to the place (real shape)
//   null                   a straight side road (no route found)
// ~3,000 requests (about 10-15 minutes); resumable via scripts/.cache/route-spurs.json.
import fs from 'node:fs';
import path from 'node:path';
import { readCache, writeCache, routeBetween, sleep, DATA_DIR, writeRows, FLAGS } from './lib/io.mjs';
import { simplify, round4, kmLL } from './lib/geo.mjs';
import { proj, unproj, KM_PER_UNIT } from '../src/projection.js';
import { ROADS, TOWNS } from '../src/data/network.js';

const CACHE = 'route-spurs.json';
const ON_ROAD_KM = 0.9;        // closer than this to a main road: the place is on it
const JUNCTION_KM = 0.05;      // a street path "touches" a main road within this distance
const SPUR_TOL_KM = 0.05;
const CONCURRENCY = 3, DELAY_MS = 220;
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? +limitArg.split('=')[1] : Infinity;

console.log('Place access roads');
const places = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'places.json'), 'utf8')).map(([name, lat, lon, kind]) => ({ name, lat, lon, kind, ...proj(lat, lon) }));
const shapes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'roads.json'), 'utf8'));
const town = Object.fromEntries(TOWNS.map(([n, lat, lon]) => [n, proj(lat, lon)]));

// ---- the main roads as segments in map units, in a grid so nearest-point queries are fast ----
const CELL = 0.25, segs = [], grid = new Map();
const cellKey = (cx, cy) => cx + ',' + cy;
for (const [a, b] of ROADS) {
  const s = shapes[a + '|' + b];
  const pts = s ? s.map(([lat, lon]) => proj(lat, lon)) : [town[a], town[b]];
  for (let i = 1; i < pts.length; i++) {
    const seg = { ax: pts[i - 1].x, ay: pts[i - 1].y, bx: pts[i].x, by: pts[i].y }; const id = segs.push(seg) - 1;
    for (let cx = Math.floor(Math.min(seg.ax, seg.bx) / CELL); cx <= Math.floor(Math.max(seg.ax, seg.bx) / CELL); cx++)
      for (let cy = Math.floor(Math.min(seg.ay, seg.by) / CELL); cy <= Math.floor(Math.max(seg.ay, seg.by) / CELL); cy++) {
        const k = cellKey(cx, cy); (grid.get(k) || grid.set(k, []).get(k)).push(id);
      }
  }
}
function nearestOnRoads(x, y) { // { x, y, d } nearest point on any main road, d in map units
  let best = null;
  for (let r = 0; r < 400; r++) {
    if (best && (r - 1) * CELL > best.d) break;
    const cx0 = Math.floor(x / CELL), cy0 = Math.floor(y / CELL);
    for (let cx = cx0 - r; cx <= cx0 + r; cx++) for (let cy = cy0 - r; cy <= cy0 + r; cy++) {
      if (Math.max(Math.abs(cx - cx0), Math.abs(cy - cy0)) !== r) continue;
      for (const id of grid.get(cellKey(cx, cy)) || []) {
        const s = segs[id], dx = s.bx - s.ax, dy = s.by - s.ay, l = dx * dx + dy * dy;
        let t = l ? ((x - s.ax) * dx + (y - s.ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
        const px = s.ax + t * dx, py = s.ay + t * dy, d = Math.hypot(x - px, y - py);
        if (!best || d < best.d) best = { x: px, y: py, d };
      }
    }
  }
  return best;
}
const toKm = u => u * KM_PER_UNIT;
const JUNCTION_UNITS = JUNCTION_KM / KM_PER_UNIT;
function touchesRoad(x, y) {              // is a main road within JUNCTION_KM? (only the 3x3 cells around the point matter)
  const cx0 = Math.floor(x / CELL), cy0 = Math.floor(y / CELL);
  for (let cx = cx0 - 1; cx <= cx0 + 1; cx++) for (let cy = cy0 - 1; cy <= cy0 + 1; cy++) {
    for (const id of grid.get(cellKey(cx, cy)) || []) {
      const s = segs[id], dx = s.bx - s.ax, dy = s.by - s.ay, l = dx * dx + dy * dy;
      let u = l ? ((x - s.ax) * dx + (y - s.ay) * dy) / l : 0; u = Math.max(0, Math.min(1, u));
      if (Math.hypot(x - (s.ax + u * dx), y - (s.ay + u * dy)) <= JUNCTION_UNITS) return true;
    }
  }
  return false;
}

// ---- decide, per place, on the road or a side road that needs a real path ----
const plan = places.map(p => ({ p, hit: nearestOnRoads(p.x, p.y) }));
const onRoad = plan.filter(x => toKm(x.hit.d) <= ON_ROAD_KM).length;
console.log(`  ${places.length} places: ${onRoad} sit on a main road, ${places.length - onRoad} need a side road`);

const done = FLAGS.has('--refresh') ? {} : (readCache(CACHE) || {});
const todo = plan.map((x, i) => i).filter(i => toKm(plan[i].hit.d) > ON_ROAD_KM && !done[i]).slice(0, LIMIT);
console.log(`  ${Object.keys(done).length} already routed, ${todo.length} to fetch`);
let finished = 0, failed = 0, next = 0; const started = Date.now();
async function worker() {
  while (next < todo.length) {
    const i = todo[next++], { p, hit } = plan[i];
    const ll = unproj(hit.x, hit.y);
    const r = await routeBetween([p.lon, p.lat], [ll.lon, ll.lat]);   // from the place out to the main road
    let entry = { ok: false };
    if (r.ok) {
      const pts = r.coords;                                            // [lon, lat], place first
      let cut = -1;
      for (let k = 0; k < pts.length; k++) {                          // first point that touches a main road
        const q = proj(pts[k][1], pts[k][0]);
        if (touchesRoad(q.x, q.y)) { cut = k; break; }
      }
      if (cut > 0) {
        const junction = proj(pts[cut][1], pts[cut][0]), snap = nearestOnRoads(junction.x, junction.y), jl = unproj(snap.x, snap.y);
        const side = pts.slice(0, cut + 1).reverse().map(([lon, lat]) => [lat, lon]);   // junction -> place
        const len = side.reduce((s, q, k) => k ? s + kmLL(side[k - 1][0], side[k - 1][1], q[0], q[1]) : 0, 0);
        const straight = kmLL(jl.lat, jl.lon, p.lat, p.lon);
        const jr = round4([jl.lat, jl.lon]);
        if (len <= straight * 3.5 + 3) entry = { ok: true, jlat: jr[0], jlon: jr[1], coords: simplify(side, SPUR_TOL_KM).map(round4) };
      }
    }
    if (!entry.ok) failed++;
    done[i] = entry; finished++;
    if (finished % 100 === 0) {
      writeCache(CACHE, done);
      const rate = finished / ((Date.now() - started) / 1000);
      console.log(`  ${finished}/${todo.length} routed (${failed} straight), ${rate.toFixed(1)}/s, ~${Math.round((todo.length - finished) / rate / 60)} min left`);
    }
    await sleep(DELAY_MS);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
writeCache(CACHE, done);

// ---- write the data file ----
let straightSide = 0, shaped = 0;
const rows = plan.map(({ p, hit }, i) => {
  const pll = unproj(hit.x, hit.y), a = round4([pll.lat, pll.lon]);
  if (toKm(hit.d) <= ON_ROAD_KM) return `[${i},${JSON.stringify(p.name)},${a[0]},${a[1]},0]`;
  const d = done[i];
  if (d && d.ok) { shaped++; return `[${i},${JSON.stringify(p.name)},${d.jlat},${d.jlon},${JSON.stringify(simplify(d.coords, 0.08).map(round4))}]`; }
  straightSide++; return `[${i},${JSON.stringify(p.name)},${a[0]},${a[1]},null]`;
});
writeRows(path.join(DATA_DIR, 'local-roads.json'), rows);
console.log(`  wrote src/data/local-roads.json: ${rows.length} places (${onRoad} on a road, ${shaped} side roads with a real shape, ${straightSide} straight side roads)`);

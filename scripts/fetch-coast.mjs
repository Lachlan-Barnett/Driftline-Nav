// Builds src/data/coast.json: Queensland's real coastline from open map data (natural=coastline).
//
//   node scripts/fetch-coast.mjs [--refresh]
//
// Coastline ways are directed with the land on their left. This script stitches them into
// chains, cuts the mainland chain to the Queensland stretch (Point Danger -> around Cape York ->
// the NT border in the Gulf), closes it along the NSW / SA / NT borders, and keeps every island
// bigger than MIN_ISLAND_KM2. Output: an array of rings ([lat, lon] points), mainland first.
import path from 'node:path';
import { cached, queryMap, DATA_DIR, writeRows } from './lib/io.mjs';
import { simplify, round4, ringAreaKm2, kmLL } from './lib/geo.mjs';

const MIN_ISLAND_KM2 = 3;
const MAINLAND_TOL_KM = 0.12, ISLAND_TOL_KM = 0.1;
const POINT_DANGER = [-28.1667, 153.5507];   // NSW border on the coast (chain start)
const NT_BORDER_LON = 138.0;                  // NT border (chain end, in the Gulf of Carpentaria)

// Border from Point Danger inland to the NT/SA corner (was hand-traced: Macpherson Range, the
// Dumaresq / Macintyre rivers, 29 S, 141 E, 26 S). Order: coast end -> NT corner.
const BORDER = [
  [-28.20, 153.30], [-28.25, 153.00], [-28.29, 152.77], [-28.45, 152.50], [-28.60, 152.20], [-28.75, 152.05],
  [-28.93, 151.93], [-28.95, 151.60], [-28.95, 151.30], [-28.85, 151.00], [-28.72, 150.70], [-28.68, 150.40],
  [-28.66, 150.20], [-28.66, 149.80], [-28.85, 149.40], [-29.00, 149.00], [-29.00, 141.00], [-26.00, 141.00],
  [-26.00, 138.00],
];

console.log('Coastline');
const raw = await cached('coast-ways.json', () =>
  queryMap('[out:json][timeout:270];way["natural"="coastline"](-29.3,137.8,-9.0,154.3);out geom;'));

// ---- stitch ways into chains ----
const key = p => p.lat.toFixed(7) + ',' + p.lon.toFixed(7);
const ways = raw.elements.filter(w => w.geometry && w.geometry.length > 1).map(w => w.geometry.map(g => [g.lat, g.lon]));
const byStart = new Map();
ways.forEach((w, i) => { const k = key({ lat: w[0][0], lon: w[0][1] }); (byStart.get(k) || byStart.set(k, []).get(k)).push(i); });
const used = new Uint8Array(ways.length);
const hasPredecessor = new Set(ways.map(w => key({ lat: w[w.length - 1][0], lon: w[w.length - 1][1] })));
function follow(startIdx) {
  const pts = []; let i = startIdx;
  while (i !== undefined && !used[i]) {
    used[i] = 1;
    const w = ways[i]; pts.push(...(pts.length ? w.slice(1) : w));
    const last = w[w.length - 1];
    i = (byStart.get(key({ lat: last[0], lon: last[1] })) || []).find(j => !used[j]);
  }
  return pts;
}
const chains = [];
// open chains first (their first point is nobody's last point), then whatever is left is closed rings
ways.forEach((w, i) => { if (!used[i] && !hasPredecessor.has(key({ lat: w[0][0], lon: w[0][1] }))) chains.push(follow(i)); });
ways.forEach((w, i) => { if (!used[i]) chains.push(follow(i)); });
const isClosed = c => c.length > 3 && key({ lat: c[0][0], lon: c[0][1] }) === key({ lat: c[c.length - 1][0], lon: c[c.length - 1][1] });
console.log(`  ${ways.length} ways -> ${chains.length} chains (${chains.filter(isClosed).length} closed)`);

// ---- the mainland: the open chain that runs from Point Danger to the Gulf ----
const nearest = (chain, [lat, lon]) => { let bi = 0, bd = Infinity; chain.forEach((p, i) => { const d = kmLL(p[0], p[1], lat, lon); if (d < bd) { bd = d; bi = i; } }); return { i: bi, d: bd }; };
let mainland = null;
for (const c of chains.filter(c => !isClosed(c)).sort((a, b) => b.length - a.length)) {
  const a = nearest(c, POINT_DANGER);
  if (a.d < 3) { mainland = { chain: c, start: a.i }; break; }
}
if (!mainland) throw new Error('could not find the mainland coastline chain');
const { chain, start } = mainland;
// walk forward from Point Danger until the chain crosses the NT border (lon 138) in the Gulf (lat -19..-16)
let end = -1, cross = null;
for (let i = start; i < chain.length - 1; i++) {
  const a = chain[i], b = chain[i + 1];
  if (a[0] < -16 && a[0] > -19.5 && a[1] > NT_BORDER_LON && b[1] <= NT_BORDER_LON) {
    const t = (a[1] - NT_BORDER_LON) / (a[1] - b[1]);
    cross = [a[0] + (b[0] - a[0]) * t, NT_BORDER_LON]; end = i; break;
  }
}
if (end < 0) throw new Error('mainland chain never crosses the NT border');
const coast = chain.slice(start, end + 1); coast.push(cross);
console.log(`  mainland coast: ${coast.length} raw points, NT crossing at lat ${cross[0].toFixed(3)}`);
const ring = [...simplify(coast, MAINLAND_TOL_KM), ...BORDER.slice().reverse()];

// ---- islands ----
const rings = [ring.map(round4)];
let dropped = 0;
for (const c of chains.filter(isClosed)) {
  const lat = c.reduce((s, p) => s + p[0], 0) / c.length, lon = c.reduce((s, p) => s + p[1], 0) / c.length;
  if (lat > -9.9 || lat < -28.17 || lon < 138 || lon > 154.3) { dropped++; continue; }   // PNG, NSW, NT
  if (ringAreaKm2(c) < MIN_ISLAND_KM2) { dropped++; continue; }
  rings.push(simplify(c, ISLAND_TOL_KM).map(round4));
}
console.log(`  ${rings.length - 1} islands kept, ${dropped} dropped (too small or outside Queensland)`);

const file = path.join(DATA_DIR, 'coast.json');
writeRows(file, rings.map(r => JSON.stringify(r)));
const pts = rings.reduce((s, r) => s + r.length, 0);
console.log(`  wrote src/data/coast.json: ${rings.length} rings, ${pts} points`);

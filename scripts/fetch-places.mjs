// Builds src/data/places.json: every named city, town, village, hamlet, suburb and locality in
// Queensland from OpenStreetMap, minus anything already on the road network or off the coast.
//
//   node scripts/fetch-places.mjs [--refresh]
//
// Rows are [name, lat, lon, kind]. Run `npm run data:coast` first: places are kept only if they
// fall on (or within ~1 km of) the coastline polygons in coast.json.
import fs from 'node:fs';
import path from 'node:path';
import { cached, overpass, DATA_DIR, writeRows } from './lib/io.mjs';
import { kmLL, toWorld, pointInRing, distToRing } from './lib/geo.mjs';
import { proj } from '../src/projection.js';
import { TOWNS } from '../src/data/network.js';

const KIND = { city: 'city', town: 'town', village: 'village', hamlet: 'hamlet', suburb: 'suburb', neighbourhood: 'suburb', quarter: 'suburb', locality: 'locality' };
const ORDER = ['city', 'town', 'village', 'hamlet', 'suburb', 'locality'];
const COAST_SLACK_UNITS = 0.55; // ~1 km: OSM points sit right on the shore

console.log('Places');
const towns = await cached('places-towns.json', () => overpass(
  '[out:json][timeout:150];area["ISO3166-2"="AU-QLD"]->.a;node["place"~"^(city|town|village|hamlet)$"](area.a);out;'));
const subs = await cached('places-subs.json', () => overpass(
  '[out:json][timeout:170];area["ISO3166-2"="AU-QLD"]->.a;node["place"~"^(suburb|neighbourhood|quarter|locality)$"]["name"](area.a);out;'));

const coastFile = path.join(DATA_DIR, 'coast.json');
if (!fs.existsSync(coastFile)) throw new Error('src/data/coast.json is missing: run `npm run data:coast` first');
const land = JSON.parse(fs.readFileSync(coastFile, 'utf8')).map(toWorld);
const onLand = p => land.some(r => pointInRing(p, r)) || land.some(r => distToRing(p, r) < COAST_SLACK_UNITS);

const networkNames = new Set(TOWNS.map(t => t[0].toLowerCase()));
const network = TOWNS.map(([name, lat, lon]) => ({ name: name.toLowerCase(), lat, lon }));
const kept = [];
const dropped = { onNetwork: 0, offLand: 0, duplicate: 0 };

for (const e of [...towns.elements, ...subs.elements]) {
  if (!e.tags || !e.tags.name) continue;
  const kind = KIND[e.tags.place]; if (!kind) continue;
  const name = e.tags.name.trim(), lower = name.toLowerCase();
  const small = ORDER.indexOf(kind) <= 3;   // city..hamlet: a real settlement in its own right
  if (small) {
    if (networkNames.has(lower) || network.some(n => kmLL(n.lat, n.lon, e.lat, e.lon) < 1.5)) { dropped.onNetwork++; continue; }
  } else if (network.some(n => n.name === lower && kmLL(n.lat, n.lon, e.lat, e.lon) < 15)) { dropped.onNetwork++; continue; } // suburb named like its town
  if (!onLand(proj(e.lat, e.lon))) { dropped.offLand++; continue; }
  const radius = small ? 3 : 5;
  if (kept.some(k => k.name.toLowerCase() === lower && kmLL(k.lat, k.lon, e.lat, e.lon) < radius)) { dropped.duplicate++; continue; }
  kept.push({ name, lat: e.lat, lon: e.lon, kind });
}

kept.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || a.name.localeCompare(b.name));
writeRows(path.join(DATA_DIR, 'places.json'), kept.map(k => JSON.stringify([k.name, +k.lat.toFixed(4), +k.lon.toFixed(4), k.kind])));
const counts = {}; kept.forEach(k => counts[k.kind] = (counts[k.kind] || 0) + 1);
console.log(`  wrote src/data/places.json: ${kept.length} places`, counts, 'dropped', dropped);

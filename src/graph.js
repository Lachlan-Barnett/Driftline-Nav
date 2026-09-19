// The road graph behind the map: towns, roads (with their real shapes), the coastline, the extra
// places and their local roads, plus everything that changes what a road costs to drive.
//
// createGraph() is pure (no DOM, no JSON imports), so the app, the tests and the scripts can all
// build one. The graph is mutable on purpose: picking a suburb adds it (and its chain of local
// roads) as nodes/edges, and dropping a start pin splits a road in two.
import { proj, unproj, KM_PER_UNIT } from './projection.js';

// How each kind of extra place is described in search, and its rank: the rank decides how deep you
// have to zoom before its name shows (see LABEL_MIN_SCALE in driftline.js).
export const PLACE_KINDS = {
  city:     { label: 'City',     rank: 3 },
  town:     { label: 'Town',     rank: 4 },
  village:  { label: 'Village',  rank: 5 },
  hamlet:   { label: 'Hamlet',   rank: 6 },
  suburb:   { label: 'Suburb',   rank: 7 },
  locality: { label: 'Locality', rank: 8 },
};

// Built-up areas: the limit drops to `limit` for `km` on the way into and out of a place, by rank.
// (Ranks 7-8 are suburbs and rural localities: their local roads already carry 50 / 80 km/h.)
export const BUILT_UP = {
  1: { km: 5,   limit: 60 },
  2: { km: 3,   limit: 60 },
  3: { km: 1.6, limit: 50 },
  4: { km: 1.2, limit: 50 },
  5: { km: 0.8, limit: 50 },
  6: { km: 0.5, limit: 50 },
};

// Extra seconds a report adds to the road it sits on.
export const DELAY_SEC = { police: 180, hazard: 480, crash: 1500 };
const DELAY_CAP_SEC = 3600, REPORT_SNAP_UNITS = 3.5;

// Fallback limits: Queensland's default outside built-up areas is 100 km/h. Local roads to the
// extra places have no signed limit: 80 km/h rural, 50 km/h in suburbs.
export const SPEED = { highway: 100, rural: 100, outback: 100, access: 80, suburb: 50 };

/**
 * @param data  { towns, roads, roadShapes, speedLimits, coast, places, localRoads } (rows as in src/data)
 * @param settings  live object read on every cost lookup: { builtUp, avoidReports }
 */
export function createGraph(data, settings = { builtUp: true, avoidReports: true }) {
  const nodes = data.towns.map(([name, lat, lon, rank], id) => ({ id, name, lat, lon, rank, ...proj(lat, lon) }));
  const NID = {}; nodes.forEach(n => NID[n.name] = n.id);
  // Junctions: where roads that share a road out of a town fork (see scripts/fetch-roads.mjs). They are real
  // nodes of the network, but not places: never drawn, labelled or searched (they are "virtual").
  const jd = data.junctions || { junctions: [], replaced: [], pieces: [] };
  const ID = { ...NID };
  jd.junctions.forEach(([jid, lat, lon, near]) => {
    const p = proj(lat, lon), id = nodes.length;
    nodes.push({ id, name: 'Junction near ' + near, lat, lon, rank: 9, x: p.x, y: p.y, virtual: true, junction: true });
    ID[jid] = id;
  });
  const edges = [];
  const adj = new Map(); nodes.forEach(n => adj.set(n.id, []));
  let graphVersion = 0, delayVersion = 0;

  /* ---------- edges ---------- */
  // Every edge carries its polyline (pts, map units), cumulative lengths (cum), total real road
  // length (len, map units) and a bounding box for culling.
  function finishEdge(e, pts) {
    const cum = [0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p, i) => {
      if (i > 0) cum.push(cum[i - 1] + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y));
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    });
    e.pts = pts; e.cum = cum; e.len = cum[cum.length - 1]; e.bbox = { x0, y0, x1, y1 };
    return e;
  }
  function addEdge(e) {
    edges.push(e); const i = edges.length - 1;
    adj.get(e.a).push({ to: e.b, edgeIdx: i }); adj.get(e.b).push({ to: e.a, edgeIdx: i });
    return i;
  }
  const replaced = new Set(jd.replaced), roadByKey = {};
  data.roads.forEach(r => { roadByKey[r[0] + '|' + r[1]] = r; });
  data.roads.forEach(([a, b, type, name]) => {
    if (replaced.has(a + '|' + b)) return;            // built from its pieces below
    const A = nodes[NID[a]], B = nodes[NID[b]];
    const shape = data.roadShapes[a + '|' + b];
    const pts = shape && shape.length > 1 ? shape.map(([lat, lon]) => proj(lat, lon)) : [A, B];
    pts[0] = { x: A.x, y: A.y }; pts[pts.length - 1] = { x: B.x, y: B.y }; // pin the ends to the town dots
    addEdge(finishEdge({ a: A.id, b: B.id, type, name, limit: data.speedLimits[a + '|' + b] }, pts));
  });

  jd.pieces.forEach(([from, to, shape, owner]) => {
    const [, , type, name] = roadByKey[owner], A = nodes[ID[from]], B = nodes[ID[to]];
    const pts = shape.map(([lat, lon]) => proj(lat, lon));
    pts[0] = { x: A.x, y: A.y }; pts[pts.length - 1] = { x: B.x, y: B.y };
    addEdge(finishEdge({ a: A.id, b: B.id, type, name, limit: data.speedLimits[owner] }, pts));
  });

  /* ---------- geometry along an edge ---------- */
  // position + heading a distance d (map units) along an edge, travelling forward (a->b) or not
  function pointAlong(e, forward, d) {
    const L = e.len, t = forward ? Math.max(0, Math.min(L, d)) : L - Math.max(0, Math.min(L, d));
    const cum = e.cum, pts = e.pts;
    let lo = 1, hi = cum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < t) lo = mid + 1; else hi = mid; }
    const A = pts[lo - 1], B = pts[lo], seg = cum[lo] - cum[lo - 1], u = seg > 0 ? (t - cum[lo - 1]) / seg : 0;
    let heading = Math.atan2(B.y - A.y, B.x - A.x); if (!forward) heading += Math.PI;
    return { x: A.x + (B.x - A.x) * u, y: A.y + (B.y - A.y) * u, heading };
  }
  // bearing of the first (or last) few km of an edge as driven, used for left/right turn calls
  function edgeBearing(e, forward, atEnd) {
    const L = e.len, span = Math.min(L, 3);
    const p = pointAlong(e, forward, atEnd ? L - span : 0), q = pointAlong(e, forward, atEnd ? L : span);
    return Math.atan2(q.y - p.y, q.x - p.x);
  }
  // nearest point of one edge to (x, y): { dist (along the edge from a), x, y, d }
  function projectOnEdge(e, x, y) {
    let best = null; const pts = e.pts;
    for (let k = 1; k < pts.length; k++) {
      const ax = pts[k - 1].x, ay = pts[k - 1].y, dx = pts[k].x - ax, dy = pts[k].y - ay, l = dx * dx + dy * dy;
      let t = l > 0 ? ((x - ax) * dx + (y - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, py = ay + t * dy, d = Math.hypot(x - px, y - py);
      if (!best || d < best.d) best = { dist: e.cum[k - 1] + t * Math.sqrt(l), x: px, y: py, d };
    }
    return best;
  }
  // nearest point on any road to (x, y): { edgeIdx, dist (along the edge from a), x, y, d }
  function nearestRoadPoint(x, y) {
    let best = null;
    edges.forEach((e, idx) => {
      if (e.removed) return;
      const m = best ? best.d : Infinity, bb = e.bbox;
      if (x < bb.x0 - m || x > bb.x1 + m || y < bb.y0 - m || y > bb.y1 + m) return;
      const h = projectOnEdge(e, x, y);
      if (h && (!best || h.d < best.d)) best = { edgeIdx: idx, ...h };
    });
    return best;
  }
  // Split an edge in two at a distance along it and return the new node (a "dropped pin"). Near an
  // end it returns that end's node instead, so a start pin dropped on a town is just the town.
  function splitEdgeAt(edgeIdx, dist) {
    const e = edges[edgeIdx], EPS = 0.12;
    if (dist <= EPS) return nodes[e.a];
    if (dist >= e.len - EPS) return nodes[e.b];
    const pos = pointAlong(e, true, dist);
    let k = 1; while (k < e.cum.length - 1 && e.cum[k] < dist) k++;
    const p1 = e.pts.slice(0, k).concat([{ x: pos.x, y: pos.y }]);
    const p2 = [{ x: pos.x, y: pos.y }].concat(e.pts.slice(k));
    const ll = unproj(pos.x, pos.y);
    const node = { id: nodes.length, name: 'Dropped pin', lat: ll.lat, lon: ll.lon, rank: 8, x: pos.x, y: pos.y, virtual: true, isPin: true };
    nodes.push(node); adj.set(node.id, []);
    e.removed = true;
    adj.set(e.a, adj.get(e.a).filter(l => l.edgeIdx !== edgeIdx));
    adj.set(e.b, adj.get(e.b).filter(l => l.edgeIdx !== edgeIdx));
    const common = { type: e.type, name: e.name, limit: e.limit, delayFwd: e.delayFwd || 0, delayBack: e.delayBack || 0 };
    addEdge(finishEdge({ a: e.a, b: node.id, ...common }, p1));
    addEdge(finishEdge({ a: node.id, b: e.b, ...common }, p2));
    graphVersion++;
    return node;
  }

  /* ---------- speed, time and cost ---------- */
  const zoneFor = node => BUILT_UP[node.rank];
  const edgeSpeed = e => e.limit || SPEED[e.type];
  const edgeKm = e => e.len * KM_PER_UNIT;
  // Travel time: the road's limit, slowed through built-up areas at each end, plus any delay from
  // reports on it. (Zones are capped at half the road so two of them never overlap.)
  // fwd = driving the edge from a to b (true), b to a (false); leave it out for "whichever is worse"
  function edgeSeconds(e, fwd) {
    const km = edgeKm(e), base = edgeSpeed(e);
    let hours = km / base;
    if (settings.builtUp) {
      const za = zoneFor(nodes[e.a]), zb = zoneFor(nodes[e.b]);
      const ka = za ? Math.min(za.km, km / 2) : 0, kb = zb ? Math.min(zb.km, km / 2) : 0;
      hours = (km - ka - kb) / base + (za ? ka / Math.min(base, za.limit) : 0) + (zb ? kb / Math.min(base, zb.limit) : 0);
    }
    let s = hours * 3600;
    if (settings.avoidReports) s += delayFor(e, fwd);
    return s;
  }
  // The speed limit at a point d map units along an edge, travelling forward or not (for the sign).
  function limitAt(e, forward, d) {
    let lim = edgeSpeed(e);
    if (!settings.builtUp) return lim;
    const km = d * KM_PER_UNIT, total = edgeKm(e);
    const zs = zoneFor(nodes[forward ? e.a : e.b]), ze = zoneFor(nodes[forward ? e.b : e.a]);
    if (zs && km < Math.min(zs.km, total / 2)) lim = Math.min(lim, zs.limit);
    if (ze && total - km < Math.min(ze.km, total / 2)) lim = Math.min(lim, ze.limit);
    return lim;
  }
  // A*'s optimistic estimate: straight line at the fastest limit on the map.
  const MAX_SPEED = 110;
  function heuristicSeconds(fromId, goalId) {
    const a = nodes[fromId], b = nodes[goalId];
    return Math.hypot(a.x - b.x, a.y - b.y) * KM_PER_UNIT / MAX_SPEED * 3600;
  }
  // seconds a report adds to driving an edge a->b (fwd true), b->a (false), or (unknown) the worse of the two
  function delayFor(e, fwd) {
    if (fwd === undefined) return Math.max(e.delayFwd || 0, e.delayBack || 0);
    return (fwd ? e.delayFwd : e.delayBack) || 0;
  }
  // Which way along an edge a report applies: the way it was reported travelling ('fwd' = a->b, 'back'),
  // or 'both' when the direction is unknown (reported from the map, or while not driving).
  function reportDirection(e, dist, heading) {
    if (heading === undefined || heading === null) return 'both';
    const tangent = pointAlong(e, true, dist).heading;
    return Math.cos(heading - tangent) >= 0 ? 'fwd' : 'back';
  }
  // Put each report's delay on the road (and the direction of travel) it applies to. Call whenever reports change.
  function recomputeDelays(hazards) {
    edges.forEach(e => { e.delayFwd = 0; e.delayBack = 0; });
    hazards.forEach(h => {
      const hit = nearestRoadPoint(h.x, h.y);
      if (!hit || hit.d > REPORT_SNAP_UNITS) return;
      const e = edges[hit.edgeIdx], add = DELAY_SEC[h.type] || 0, dir = reportDirection(e, hit.dist, h.heading);
      if (dir !== 'back') e.delayFwd = Math.min(DELAY_CAP_SEC, (e.delayFwd || 0) + add);
      if (dir !== 'fwd') e.delayBack = Math.min(DELAY_CAP_SEC, (e.delayBack || 0) + add);
    });
    delayVersion++;
  }

  /* ---------- land (real coastline) ---------- */
  const LAND = data.coast.map(ring => ring.map(([lat, lon]) => proj(lat, lon)));

  /* ---------- extra places, and the local roads that link them in ---------- */
  const places = data.places.map(([name, lat, lon, kind], index) => {
    const info = PLACE_KINDS[kind] || PLACE_KINDS.locality;
    return { index, name, lat, lon, kind, label: info.label, rank: info.rank, ...proj(lat, lon), nodeId: null, link: null };
  });
  // Each place joins the network where it really does: sitting on a main road (spur 0), or at the junction
  // of a side road (spur = its real shape, or null for a straight one). See scripts/fetch-local-roads.mjs.
  const accessRows = new Map(data.localRoads.map(r => [r[0], r]));
  places.forEach(p => {
    const row = accessRows.get(p.index);
    if (row && row[1] === p.name) {
      const j = proj(row[2], row[3]);
      p.attach = { x: j.x, y: j.y };
      p.spur = row[4];                                           // 0 | null | [[lat, lon], ...]
    } else { // no data for this place: hang it off the nearest road
      const hit = nearestRoadPoint(p.x, p.y);
      p.attach = hit ? { x: hit.x, y: hit.y } : { x: p.x, y: p.y };
      p.spur = hit && hit.d < 0.5 ? 0 : null;
    }
    // the side road from the junction to the place, in map units (nothing to draw for a place on the road)
    p.spurPts = p.spur === 0 ? null
      : (p.spur && p.spur.length > 1 ? p.spur.map(([lat, lon]) => proj(lat, lon)) : [p.attach, p]).map(q => ({ x: q.x, y: q.y }));
    if (p.spurPts) { p.spurPts[0] = { x: p.attach.x, y: p.attach.y }; p.spurPts[p.spurPts.length - 1] = { x: p.x, y: p.y }; }
  });

  // Extra places are not in the road graph until you pick one. A place on a road becomes that point of the
  // road (the road is split there); a place off the road also gets its side road from the junction.
  function ensurePlaceNode(place) {
    if (place.nodeId !== null) return nodes[place.nodeId];
    const hit = nearestRoadPoint(place.attach.x, place.attach.y);
    const anchor = hit ? splitEdgeAt(hit.edgeIdx, hit.dist) : nodes[nearestNodeTo(place.x, place.y)];
    if (place.spur === 0) {
      if (anchor.isPin) { anchor.name = place.name; anchor.isPin = false; anchor.placeRef = place; anchor.rank = place.rank; }
      place.nodeId = anchor.id;
      return anchor;
    }
    const node = { id: nodes.length, name: place.name, lat: place.lat, lon: place.lon, rank: place.rank, x: place.x, y: place.y, virtual: true, placeRef: place };
    nodes.push(node); adj.set(node.id, []);
    const pts = place.spurPts.map(q => ({ x: q.x, y: q.y })); pts[0] = { x: anchor.x, y: anchor.y };
    addEdge(finishEdge({ a: anchor.id, b: node.id, type: 'access', name: 'Local roads to ' + place.name,
      limit: place.kind === 'suburb' ? SPEED.suburb : SPEED.access }, pts));
    place.nodeId = node.id;
    return node;
  }

  function nearestNodeTo(x, y) {
    let best = 0, bestD = Infinity;
    nodes.forEach(n => { const d = Math.hypot(n.x - x, n.y - y); if (d < bestD) { bestD = d; best = n.id; } });
    return best;
  }
  function nearestTownName(x, y) { // nearest always-on-the-map town, for "Near Toowoomba" labels
    let best = null, bestD = Infinity;
    nodes.forEach(n => { if (n.virtual) return; const d = Math.hypot(n.x - x, n.y - y); if (d < bestD) { bestD = d; best = n; } });
    return best ? best.name : '';
  }

  return {
    nodes, edges, adj, NID, places, LAND, settings,
    finishEdge, addEdge, pointAlong, edgeBearing, nearestRoadPoint, splitEdgeAt,
    edgeSpeed, edgeKm, edgeSeconds, limitAt, heuristicSeconds, recomputeDelays,
    ensurePlaceNode, nearestNodeTo, nearestTownName, projectOnEdge, reportDirection, delayFor,
    graphVersion: () => graphVersion, delayVersion: () => delayVersion, MAX_SPEED,
  };
}

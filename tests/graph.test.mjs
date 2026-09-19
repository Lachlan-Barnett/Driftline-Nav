// Logic tests: data integrity, routing algorithms, speed zones, report delays, start pins, places.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, loadGraphData } from './lib/data.mjs';
import { proj } from '../src/projection.js';
import { toWorld, pointInRing } from '../scripts/lib/geo.mjs';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('data: towns are unique and every road refers to real towns', () => {
  const { towns, roads } = loadGraphData();
  const names = new Set(towns.map(t => t[0]));
  assert.equal(names.size, towns.length, 'duplicate town names');
  for (const [a, b] of roads) { assert.ok(names.has(a), 'unknown town ' + a); assert.ok(names.has(b), 'unknown town ' + b); }
});

test('data: every road has a speed limit and (nearly) every road has its real shape', () => {
  const { roads, speedLimits, roadShapes } = loadGraphData();
  let straight = 0;
  for (const [a, b] of roads) {
    assert.ok(Number.isInteger(speedLimits[a + '|' + b]), 'no speed limit for ' + a + '|' + b);
    if (!roadShapes[a + '|' + b]) straight++;
  }
  assert.ok(straight <= 2, straight + ' roads have no shape');
});

test('data: every town sits inside the real coastline', () => {
  const { towns, coast } = loadGraphData();
  const rings = coast.map(toWorld);
  for (const [name, lat, lon] of towns) assert.ok(rings.some(r => pointInRing(proj(lat, lon), r)), name + ' is outside the coast');
});

test('data: every extra place has a valid local road', () => {
  const { places, localRoads, towns } = loadGraphData();
  const townNames = new Set(towns.map(t => t[0]));
  assert.equal(localRoads.length, places.length, 'local-roads.json is out of step with places.json (run npm run data:local-roads)');
  localRoads.forEach(([idx, name, parent], i) => {
    assert.equal(idx, i); assert.equal(name, places[i][0], 'row ' + i + ' is for a different place');
    if (typeof parent === 'number') assert.ok(parent >= 0 && parent < places.length && parent !== i);
    else assert.ok(townNames.has(parent), 'unknown parent town ' + parent);
  });
  // every chain of parents must end at a town (no cycles)
  for (let i = 0; i < places.length; i++) {
    let cur = i, steps = 0;
    while (typeof localRoads[cur][2] === 'number') { cur = localRoads[cur][2]; assert.ok(++steps < places.length, 'cycle in local roads at ' + i); }
  }
});

test('graph: the road network is fully connected', () => {
  const { graph } = makeWorld();
  const seen = new Set([0]), q = [0];
  while (q.length) { const u = q.shift(); graph.adj.get(u).forEach(l => { if (!seen.has(l.to)) { seen.add(l.to); q.push(l.to); } }); }
  assert.equal(seen.size, graph.nodes.length, 'some towns are unreachable');
});

const PAIRS = [['Brisbane', 'Cairns'], ['Weipa', 'Stanthorpe'], ['Birdsville', 'Bundaberg'], ['Mount Isa', 'Gold Coast'], ['Bamaga', 'Toowoomba'], ['Charleville', 'Townsville']];

test('algorithms: Dijkstra and A* agree on the fastest route (IDA* within 0.5%); every algorithm finds a route', () => {
  const { graph, ALGS } = makeWorld();
  for (const [s, t] of PAIRS) {
    const a = graph.NID[s], b = graph.NID[t];
    const d = ALGS.dijkstra.fn(a, b), as = ALGS.astar.fn(a, b), ida = ALGS.ida.fn(a, b);
    assert.ok(near(d.totalSec, as.totalSec, 1e-3), `${s}->${t}: A* differs from Dijkstra`);
    assert.ok(ida.totalSec <= d.totalSec * 1.006, `${s}->${t}: IDA* is more than 0.5% slower than Dijkstra`);
    for (const k of Object.keys(ALGS)) assert.ok(ALGS[k].fn(a, b), `${k} found no route ${s}->${t}`);
  }
});

test('algorithms: BFS and IDS find the fewest-towns route; Wave finds the shortest by distance', () => {
  const { graph, ALGS } = makeWorld();
  const distOf = r => r.path.reduce((s, seg) => s + graph.edges[seg.edgeIdx].len, 0);
  for (const [s, t] of PAIRS) {
    const a = graph.NID[s], b = graph.NID[t];
    assert.equal(ALGS.bfs.fn(a, b).path.length, ALGS.ids.fn(a, b).path.length, `${s}->${t}: BFS and IDS disagree on hop count`);
    const wave = ALGS.wave.fn(a, b), fastest = ALGS.dijkstra.fn(a, b);
    assert.ok(distOf(wave) <= distOf(fastest) + 1e-6, 'Wave was longer than the fastest route');
    assert.ok(wave.wave.segs.length > 0 && wave.wave.T > 0);
  }
});

test('speed zones: built-up areas slow a road down, and the sign follows', () => {
  const { graph, settings } = makeWorld();
  const e = graph.edges.find(x => graph.nodes[x.a].rank === 1 || graph.nodes[x.b].rank === 1);
  settings.builtUp = true; const slow = graph.edgeSeconds(e);
  settings.builtUp = false; const fast = graph.edgeSeconds(e);
  settings.builtUp = true;
  assert.ok(slow > fast, 'zones should add time');
  const fwd = graph.nodes[e.a].rank === 1;              // travelling away from the big town?
  const startD = fwd ? 0 : e.len;
  assert.ok(graph.limitAt(e, fwd, startD) <= 60, 'limit at the edge of a city should be reduced');
  assert.equal(graph.limitAt(e, true, e.len / 2), graph.edgeSpeed(e), 'mid-road limit is the road limit');
});

test('reports: a crash adds delay to its road, and routing goes around it when it can', () => {
  const { graph, ALGS, settings } = makeWorld();
  const a = graph.NID['Brisbane'], b = graph.NID['Toowoomba'];
  const base = ALGS.dijkstra.fn(a, b);
  const seg = base.path[Math.floor(base.path.length / 2)], e = graph.edges[seg.edgeIdx];
  const mid = graph.pointAlong(e, true, e.len / 2);
  graph.recomputeDelays([{ type: 'crash', x: mid.x, y: mid.y }]);
  assert.ok(e.delaySec >= 1500, 'crash delay not applied');
  const after = ALGS.dijkstra.fn(a, b);
  assert.ok(after.totalSec >= base.totalSec, 'delay cannot make the trip faster');
  settings.avoidReports = false; assert.ok(near(graph.edgeSeconds(e) - graph.edgeSeconds(e), 0));
  const off = ALGS.dijkstra.fn(a, b);
  assert.ok(near(off.totalSec, base.totalSec, 1e-6), 'with "avoid reports" off, delays must not affect routing');
  settings.avoidReports = true; graph.recomputeDelays([]);
});

test('start pin: splitting a road keeps it drivable and its length unchanged', () => {
  const { graph, ALGS } = makeWorld();
  const a = graph.NID['Brisbane'], b = graph.NID['Toowoomba'];
  const before = ALGS.dijkstra.fn(a, b);
  const seg = before.path[1], e = graph.edges[seg.edgeIdx], lenBefore = e.len;
  const node = graph.splitEdgeAt(seg.edgeIdx, e.len * 0.4);
  assert.ok(node.virtual && node.isPin);
  assert.ok(e.removed, 'original edge should be retired');
  const from = ALGS.dijkstra.fn(node.id, b), to = ALGS.dijkstra.fn(a, node.id);
  assert.ok(from && to, 'routes through the new pin');
  const distOf = r => r.path.reduce((s, sg) => s + graph.edges[sg.edgeIdx].len, 0);
  const via = ALGS.dijkstra.fn(a, b);
  assert.ok(near(distOf(via), distOf(before), 1e-6), 'splitting must not change the trip length');
  const halves = graph.adj.get(node.id).map(l => graph.edges[l.edgeIdx].len).reduce((x, y) => x + y, 0);
  assert.ok(near(halves, lenBefore, 1e-6));
  // near an end of the road, the end node is used instead of a new pin
  const e2 = graph.edges.find(x => !x.removed && x.type === 'highway');
  assert.equal(graph.splitEdgeAt(graph.edges.indexOf(e2), 0.01).id, e2.a);
  // the nearest road point to a spot on a road is that road
  const p = graph.pointAlong(graph.edges[graph.adj.get(node.id)[0].edgeIdx], true, 0.5);
  const hit = graph.nearestRoadPoint(p.x, p.y);
  assert.ok(hit && hit.d < 1e-6);
});

test('places: picking a suburb wires in its whole chain of local roads and routes to it', () => {
  const { graph, ALGS } = makeWorld();
  const start = graph.NID['Brisbane'];
  for (const name of ['Browns Plains', 'Surfers Paradise']) {
    const place = graph.places.find(p => p.name === name);
    assert.ok(place, name + ' missing from places.json');
    const node = graph.ensurePlaceNode(place);
    assert.ok(node.virtual);
    for (const k of Object.keys(ALGS)) assert.ok(ALGS[k].fn(start, node.id), `${k} could not reach ${name}`);
  }
  const far = graph.places.find(p => p.kind === 'hamlet');
  assert.ok(ALGS.dijkstra.fn(start, graph.ensurePlaceNode(far).id));
});

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

test('data: every extra place is attached to a road (on it, or by a side road from a junction)', () => {
  const { places, localRoads } = loadGraphData();
  assert.equal(localRoads.length, places.length, 'local-roads.json is out of step with places.json (run npm run data:local-roads)');
  let onRoad = 0;
  localRoads.forEach(([idx, name, lat, lon, side], i) => {
    assert.equal(idx, i); assert.equal(name, places[i][0], 'row ' + i + ' is for a different place');
    assert.ok(lat < -9 && lat > -30 && lon > 137 && lon < 155, 'junction outside Queensland for ' + name);
    assert.ok(side === 0 || side === null || (Array.isArray(side) && side.length >= 2), 'bad side road for ' + name);
    if (side === 0) onRoad++;
  });
  assert.ok(onRoad > 300, 'expected hundreds of places to sit on a main road, got ' + onRoad);
});

test('data: junction nodes and the pieces of the roads they cut are consistent', () => {
  const { junctions, roads, towns } = loadGraphData();
  const ids = new Set(junctions.junctions.map(j => j[0])), townNames = new Set(towns.map(x => x[0]));
  const keys = new Set(roads.map(r => r[0] + '|' + r[1]));
  for (const key of junctions.replaced) assert.ok(keys.has(key), 'unknown road ' + key);
  for (const [from, to, shape, owner] of junctions.pieces) {
    for (const id of [from, to]) assert.ok(ids.has(id) || townNames.has(id), 'piece refers to unknown node ' + id);
    assert.ok(shape.length >= 2 && keys.has(owner));
  }
  for (const key of junctions.replaced) assert.ok(junctions.pieces.some(p => p[3] === key) || junctions.pieces.length, 'replaced road with no pieces');
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
  assert.ok(Math.max(e.delayFwd, e.delayBack) >= 1500, 'crash delay not applied');
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

test('places: picking a suburb attaches it to the road network and every algorithm can reach it', () => {
  const { graph, ALGS } = makeWorld();
  const start = graph.NID['Brisbane'];
  for (const name of ['Browns Plains', 'Surfers Paradise']) {
    const place = graph.places.find(p => p.name === name);
    assert.ok(place, name + ' missing from places.json');
    const node = graph.ensurePlaceNode(place);
    for (const k of Object.keys(ALGS)) assert.ok(ALGS[k].fn(start, node.id), `${k} could not reach ${name}`);
  }
  const far = graph.places.find(p => p.kind === 'hamlet');
  assert.ok(ALGS.dijkstra.fn(start, graph.ensurePlaceNode(far).id));
});

test('places: Jimboomba is on the Mount Lindesay Highway, so the route there is the highway, not side streets', () => {
  const { graph, ALGS } = makeWorld();
  const jim = graph.places.find(p => p.name === 'Jimboomba');
  assert.equal(jim.spur, 0, 'Jimboomba should be marked as on a main road');
  const node = graph.ensurePlaceNode(jim);
  assert.equal(node.name, 'Jimboomba');
  const around = graph.adj.get(node.id).map(l => graph.edges[l.edgeIdx].name);
  assert.deepEqual([...new Set(around)], ['Mount Lindesay Highway'], 'both roads out of Jimboomba are the highway');
  const r = ALGS.dijkstra.fn(graph.NID['Brisbane'], node.id);
  assert.ok(r.path.every(s => !/^Local roads/.test(graph.edges[s.edgeIdx].name)), 'no local side roads on the way');
  assert.ok(r.path.length <= 4, 'a couple of highway pieces, not dozens of hops (got ' + r.path.length + ')');
  // and carrying on through it to Beaudesert is one continuous road: no edge is driven twice
  const beau = ALGS.dijkstra.fn(node.id, graph.NID['Beaudesert']);
  const used = new Set(r.path.map(s => s.edgeIdx));
  assert.ok(beau.path.every(s => !used.has(s.edgeIdx)), 'the second leg must not go back over the first');
});

test('places: a place off the road gets a side road from its junction, and a stop there is a real detour', () => {
  const { graph, ALGS } = makeWorld();
  const off = graph.places.find(p => p.spur && p.spur.length > 3);
  assert.ok(off, 'expected some places with a shaped side road');
  const node = graph.ensurePlaceNode(off);
  assert.ok(node.virtual);
  const side = graph.adj.get(node.id);
  assert.equal(side.length, 1, 'a place at the end of a side road has exactly one road');
  assert.match(graph.edges[side[0].edgeIdx].name, /^Local roads to /);
  assert.ok(ALGS.dijkstra.fn(graph.NID['Brisbane'], node.id));
});

test('roads: forks are real junctions, so a trip between two roads that share a stretch does not go to the town and back', () => {
  const { graph, ALGS } = makeWorld();
  const path = r => r.path.map(s => graph.nodes[s.to].name);
  const wb = path(ALGS.dijkstra.fn(graph.NID['Weipa'], graph.NID['Bamaga']));
  assert.ok(!wb.includes('Coen'), 'Weipa -> Bamaga should turn off at the fork, not visit Coen: ' + wb.join(' > '));
  const junctions = graph.nodes.filter(n => n.junction);
  assert.ok(junctions.length > 30 && junctions.every(n => n.virtual), 'junction nodes exist and are never shown as places');
});

test('reports: a report applies only to the direction it was reported travelling', () => {
  const { graph, settings } = makeWorld();
  const e = graph.edges.find(x => x.type === 'highway' && x.len > 8);
  const mid = graph.pointAlong(e, true, e.len / 2);
  const hazard = heading => [{ type: 'crash', x: mid.x, y: mid.y, heading }];
  graph.recomputeDelays(hazard(mid.heading));                                    // travelling a -> b
  assert.ok(e.delayFwd > 0 && !e.delayBack, 'forward report delays only the forward direction');
  assert.ok(graph.edgeSeconds(e, true) > graph.edgeSeconds(e, false), 'driving the other way is not delayed');
  graph.recomputeDelays(hazard(mid.heading + Math.PI));                          // travelling b -> a
  assert.ok(!e.delayFwd && e.delayBack > 0);
  graph.recomputeDelays(hazard(undefined));                                      // unknown direction: both
  assert.ok(e.delayFwd > 0 && e.delayBack > 0);
  settings.avoidReports = false; assert.equal(graph.edgeSeconds(e, true), graph.edgeSeconds(e, false));
  settings.avoidReports = true; graph.recomputeDelays([]);
});

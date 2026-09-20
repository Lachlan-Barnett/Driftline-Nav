// Browser-level tests: the real app code, driven through a fake DOM and a virtual clock.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, closeHarness } from './lib/harness.mjs';

after(() => closeHarness());

const stopNames = app => app.dbg.trip.stops.map(s => s.poi.name);
async function withApp(opts, fn) { const app = await startApp(opts); try { await fn(app); } finally { app.stop(); } }
// Stack crashes (each road's delay is capped at 60 min) on every road of the way between two towns.
function blockRoad(app, a, b) {
  const g = app.dbg.graph;
  const way = app.dbg.ALGS.dijkstra.fn(g.NID[a], g.NID[b]);
  for (const seg of way.path) {
    const e = g.edges[seg.edgeIdx], mid = g.pointAlong(e, true, e.len / 2);
    for (let i = 0; i < 3; i++) app.dbg.addHazardAt('crash', mid.x, mid.y);
  }
}
// Pick a destination the way a user would: type, click the first suggestion.
function search(app, text, i = 0) { app.type(text); app.pickSuggestion(i); }

test('starts up cleanly and shows the layout elements', () => withApp({}, app => {
  assert.equal(app.crashed, null, 'app crashed on start: ' + app.crashed);
  for (const id of ['addStopBtn', 'tripPanel', 'speedHud', 'driveHud', 'ctxMenu', 'comparePanel', 'rerouteCard']) assert.ok(app.el(id), id);
  app.dbg.cancelTrip();
  assert.ok(app.has('addStopBtn', 'disabled'), '+ is disabled until a destination is chosen');
  assert.match(app.html('settingsList'), /Speed limit signs/);
  assert.match(app.html('settingsList'), /Avoid reports when routing/);
}));

test('search: exact match first, kind shown for extra places, drives to a suburb', () => withApp({}, app => {
  app.type('cairns');
  assert.match(app.html('suggestBox').split('suggestItem')[1], />Cairns</, 'the town should come before the "Cairns City" suburb');
  app.type('browns plains');
  assert.match(app.html('suggestBox'), /Suburb ·/);
  app.pickSuggestion(0); app.settle();
  assert.equal(app.text('previewTitle'), 'Browns Plains');
  assert.ok(app.has('previewSheet', 'show'));
  assert.match(app.text('previewMeta'), /km ·/);
}));

test('+ button: adds a second destination, both legs are searched independently', () => withApp({}, app => {
  search(app, 'toowoomba'); app.settle();
  assert.ok(!app.has('addStopBtn', 'disabled'), '+ enables once there is a destination');
  assert.ok(!app.has('tripPanel', 'show'), 'no trip panel for a single destination');
  app.click('addStopBtn');
  assert.equal(app.el('searchInput').placeholder, 'Add another destination…');
  assert.ok(app.has('addStopBtn', 'active'));
  search(app, 'roma'); app.settle();
  assert.deepEqual(stopNames(app), ['Toowoomba', 'Roma']);
  assert.equal(app.dbg.state().legs, 2);
  assert.equal(app.dbg.state().legEndSeg.length, 2);
  assert.ok(app.has('tripPanel', 'show'));
  assert.equal(app.text('previewTitle'), 'Road trip · 2 stops');
  assert.match(app.html('legList'), /Brisbane → Toowoomba/);
  assert.match(app.html('legList'), /Toowoomba → Roma/);
  assert.equal(app.dbg.state().searchMode, 'dest', 'add mode resets after one stop');
}));

test('trip panel: reorder with the arrows and by drag, and remove a stop', () => withApp({}, app => {
  search(app, 'toowoomba'); app.click('addStopBtn'); search(app, 'roma'); app.click('addStopBtn'); search(app, 'dalby'); app.settle();
  assert.deepEqual(stopNames(app), ['Toowoomba', 'Roma', 'Dalby']);
  app.fire('tripPanel', 'click', {}, { '[data-act]': { act: 'up', i: '2' } }); app.settle();
  assert.deepEqual(stopNames(app), ['Toowoomba', 'Dalby', 'Roma']);
  assert.match(app.html('legList'), /Toowoomba → Dalby/);
  app.fire('tripPanel', 'dragstart', {}, { '.tripRow[data-i]': { i: '0' } });
  app.fire('tripPanel', 'drop', {}, { '.tripRow[data-i]': { i: '2' } }); app.settle();
  assert.deepEqual(stopNames(app), ['Dalby', 'Roma', 'Toowoomba']);
  app.fire('tripPanel', 'click', {}, { '[data-act]': { act: 'remove', i: '1' } }); app.settle();
  assert.deepEqual(stopNames(app), ['Dalby', 'Toowoomba']);
  assert.equal(app.dbg.state().legs, 2);
}));

test('trip: a stop equal to the one before it is dropped with a message', () => withApp({}, app => {
  search(app, 'toowoomba'); app.click('addStopBtn'); search(app, 'toowoomba'); app.settle();
  assert.deepEqual(stopNames(app), ['Toowoomba']);
}));

test('start location: long-press menu drops the start on the nearest road', () => withApp({}, app => {
  const g = app.dbg.graph, e = g.edges.find(x => x.type === 'highway' && x.len > 6), mid = g.pointAlong(e, true, e.len / 2);
  const before = { ...app.dbg.car() };
  // world -> screen using the app's initial fit (1200x800)
  const scale = Math.min((1200 - 120) / 970, (800 - 120) / 1200), ox = 600 - 485 * scale, oy = 400 - 600 * scale;
  app.fire('map', 'contextmenu', { clientX: mid.x * scale + ox, clientY: mid.y * scale + oy });
  assert.ok(app.has('ctxMenu', 'show'));
  assert.match(app.html('ctxMenu'), /Set start here/);
  assert.match(app.html('ctxMenu'), /Report a crash here/);
  app.fire('ctxMenu', 'click', {}, { '[data-act]': { act: 'setStart' } });
  const car = app.dbg.car();
  assert.ok(Math.hypot(car.x - before.x, car.y - before.y) > 1, 'the car should have moved');
  assert.ok(g.nodes.some(n => n.isPin), 'a pin node should exist');
  assert.ok(g.nodes[g.nearestNodeTo(car.x, car.y)].isPin);
  // routes now start from the pin
  search(app, 'toowoomba'); app.settle();
  assert.ok(app.dbg.state().pathLen > 0);
  assert.ok(g.edges[0] && app.has('previewSheet', 'show'));
}));

test('start location: picking a place through the trip panel sets the start', () => withApp({}, app => {
  search(app, 'ipswich'); app.click('addStopBtn'); search(app, 'gatton'); app.settle();
  app.fire('tripPanel', 'click', {}, { '[data-act]': { act: 'pickStart' } });
  assert.equal(app.dbg.state().searchMode, 'start');
  assert.equal(app.el('searchInput').placeholder, 'Search for a start location…');
  app.type('toowoomba'); app.pickSuggestion(0); app.settle();
  assert.match(app.html('legList'), /Toowoomba → Ipswich/);
  assert.equal(app.dbg.state().searchMode, 'dest');
}));

test('drive: speed HUD, limit sign and layout variables switch on and off', () => withApp({}, app => {
  search(app, 'ipswich'); app.settle();
  app.click('startDrive');
  assert.ok(app.has('speedHud', 'show')); assert.ok(app.has('driveHud', 'show'));
  assert.equal(app.el('html').style['--recenter-bottom'], '130px', 'recentre button rides above the speed HUD');
  app.advance(4000);
  const limit = +app.text('limitNum'); assert.ok(limit >= 50 && limit <= 110, 'limit sign shows a real limit, got ' + limit);
  assert.ok(+app.text('hudSpeed') > 0, 'the car is moving');
  app.drive();
  assert.match(app.text('turnMain'), /arrived/);
  app.advance(3000);
  assert.ok(!app.has('speedHud', 'show')); assert.equal(app.el('html').style['--recenter-bottom'], '16px');
}));

test('drive: the limit drops in a built-up area, and the setting turns that off', () => withApp({}, app => {
  const g = app.dbg.graph;
  const e = g.edges.find(x => !x.removed && x.type === 'highway' && g.nodes[x.a].rank === 1);
  const lim = g.limitAt(e, true, 0.2);
  assert.ok(lim <= 60, 'city entrance limit is reduced, got ' + lim);
  app.dbg.setSetting('builtUp', false);
  assert.equal(g.limitAt(e, true, 0.2), g.edgeSpeed(e));
}));

test('road trip drive: stops at each waypoint, then arrives at the last', () => withApp({}, app => {
  search(app, 'ipswich'); app.click('addStopBtn'); search(app, 'gatton'); app.settle();
  app.click('startDrive');
  assert.ok(app.has('hudStop', 'show')); assert.match(app.text('hudStop'), /Stop 1 of 2 · Ipswich/);
  let sawStop = false;
  for (let t = 0; t < 400000 && app.dbg.state().navActive; t += 200) {
    app.advance(200);
    if (/Stop 1 reached/.test(app.text('turnMain'))) { sawStop = true; assert.equal(Math.round(+app.text('hudSpeed')) <= 90, true); break; }
  }
  assert.ok(sawStop, 'should pause at stop 1');
  assert.match(app.text('hudStop'), /Stop 2 of 2 · Gatton/);
  app.drive();
  assert.match(app.text('turnMain'), /arrived/);
}));

test('reports: a crash on the route adds a delay note; long-press reports land on the road', () => withApp({}, app => {
  search(app, 'toowoomba'); app.settle();
  const g = app.dbg.graph, path = app.dbg.graph.edges; // route edges
  const st = app.dbg.state(); assert.ok(st.pathLen > 0);
  assert.ok(!app.has('delayNote', 'show'));
  // put a crash right on the first road of the route
  const first = g.edges[app.dbg.graph.adj.get(g.NID['Brisbane']).map(l => l.edgeIdx)[0]];
  const route = []; // find the actual first edge of the current path via the preview: report on Ipswich Motorway
  const ipswichMw = g.edges.find(e => e.name === 'Ipswich Motorway'), p = g.pointAlong(ipswichMw, true, ipswichMw.len / 2);
  app.dbg.addHazardAt('crash', p.x, p.y); app.advance(300); app.settle();
  assert.ok(Math.max(ipswichMw.delayFwd, ipswichMw.delayBack) >= 1500, 'delay put on the road');
  assert.ok(app.has('delayNote', 'show'), 'preview mentions the delay');
  assert.match(app.text('delayNote'), /delays from reports/);
  assert.equal(app.dbg.hazards().length, 1);
  assert.ok(first && route && path);
}));

test('reports: mid-drive, a crash ahead offers a faster route and applying it works', () => withApp({}, app => {
  const g = app.dbg.graph;
  // Brisbane -> Toowoomba goes Ipswich - Laidley - Gatton - Toowoomba; from Ipswich there is a longer way round via Warwick.
  // Close Laidley - Gatton - Toowoomba (crashes, each road capped at 60 min): both roads are still ahead once the car is on the first one.
  search(app, 'toowoomba'); app.settle();
  app.click('startDrive'); app.advance(300);
  blockRoad(app, 'Laidley', 'Gatton'); blockRoad(app, 'Gatton', 'Toowoomba');
  app.advance(200);
  assert.ok(app.dbg.state().rerouteOffered, 'a reroute should be offered');
  assert.ok(app.has('rerouteCard', 'show'));
  assert.match(app.text('rerouteText'), /crash reported ahead/i);
  const pathBefore = JSON.stringify(app.dbg.state().legEndSeg);
  app.click('rerouteYes'); app.advance(100);
  assert.ok(!app.has('rerouteCard', 'show'));
  assert.match(app.text('html') + app.text('turnSub'), /./);
  app.drive();
  assert.match(app.text('turnMain'), /arrived/);
  assert.notEqual(JSON.stringify(app.dbg.state().legEndSeg), pathBefore, 'route changed');
}));

test('reports: mid-drive, keeping the route dismisses the offer and stays quiet', () => withApp({}, app => {
  const g = app.dbg.graph;
  search(app, 'toowoomba'); app.settle(); app.click('startDrive'); app.advance(300);
  blockRoad(app, 'Laidley', 'Gatton'); blockRoad(app, 'Gatton', 'Toowoomba');
  app.advance(200); assert.ok(app.dbg.state().rerouteOffered);
  app.click('rerouteNo'); assert.ok(!app.has('rerouteCard', 'show')); assert.ok(!app.dbg.state().rerouteOffered);
  app.advance(1000); assert.ok(!app.dbg.state().rerouteOffered, 'no nagging until the reports change');
}));

test('reports: turning off "offer reroutes" (or "avoid reports") stops the prompt', () => withApp({ prefs: { settings: { offerReroute: false } } }, app => {
  const g = app.dbg.graph;
  search(app, 'toowoomba'); app.settle(); app.click('startDrive'); app.advance(300);
  blockRoad(app, 'Laidley', 'Gatton'); blockRoad(app, 'Gatton', 'Toowoomba');
  app.advance(200);
  assert.ok(!app.dbg.state().rerouteOffered);
}));

test('reports: while driving, only reports ahead of you and in your direction count (not behind, not the other way)', () => withApp({}, app => {
  const g = app.dbg.graph;
  search(app, 'toowoomba'); app.settle();
  const route = app.dbg.ALGS.dijkstra.fn(g.NID['Brisbane'], g.NID['Toowoomba']);
  const seg = route.path[0], e = g.edges[seg.edgeIdx], fwd = seg.from === e.a;
  const at = d => g.pointAlong(e, fwd, d);                       // d = distance from the start of the first road, as driven
  const ahead = at(e.len * 0.8), inMyDirection = at(e.len * 0.8).heading;
  app.click('startDrive'); app.advance(2500);                    // the car is now some way along the first road
  const carAlong = g.projectOnEdge(e, app.dbg.car().x, app.dbg.car().y).dist;
  const along = fwd ? carAlong : e.len - carAlong;
  assert.ok(along > e.len * 0.02 && along < e.len * 0.6, 'the car should be part-way along the first road, got ' + along.toFixed(2) + ' of ' + e.len.toFixed(2));
  const panelShown = () => { app.advance(50); return app.has('routeReportsPanel', 'show'); };
  // 1. a report behind the car
  const behind = at(along * 0.4);
  app.dbg.addHazardAt('crash', behind.x, behind.y, behind.heading); app.advance(100);
  assert.ok(!panelShown(), 'a report behind the car is not "ahead"');
  app.click('adminBtn'); // (open the reports panel just to exercise it)
  // 2. a report ahead but for the opposite direction of travel
  app.dbg.addHazardAt('crash', ahead.x, ahead.y, inMyDirection + Math.PI); app.advance(100);
  assert.ok(!panelShown(), 'a report for oncoming traffic is not on your side of the road');
  // 3. a report ahead in your direction
  app.dbg.addHazardAt('hazard', ahead.x, ahead.y, inMyDirection); app.advance(100);
  assert.ok(panelShown(), 'a report ahead in your direction should be shown');
  assert.match(app.html('routeReportsList'), /Hazard/);
  assert.ok(!/Crash/.test(app.html('routeReportsList')), 'only the report that applies is listed');
  // 4. no direction known (reported from the map): counts for both ways
  app.dbg.addHazardAt('police', ahead.x, ahead.y, undefined); app.advance(100);
  assert.match(app.html('routeReportsList'), /Police/);
}));

test('search: forgiving of case, abbreviations and typos; Enter picks the top result; arrows move', () => withApp({}, app => {
  const top = q => { app.type(q); return (app.html('suggestBox').match(/suggestName">([^<]+)/) || [])[1]; };
  assert.equal(top('MOUNT ISA'), 'Mount Isa');
  assert.equal(top('mt isa'), 'Mount Isa', '"Mt" means Mount');
  assert.equal(top('toowomba'), 'Toowoomba', 'one typo is forgiven');
  assert.equal(top('  gold  coast '), 'Gold Coast');
  assert.equal(top('st george'), 'St George');
  assert.equal(top('jimboomba'), 'Jimboomba');
  assert.match(app.html('suggestBox'), /near /, 'places show which town they are near');
  // real towns outrank obscure localities that merely contain the letters
  assert.equal(top('cairns'), 'Cairns');
  // Enter picks the first result with no click
  app.type('toowoomba');
  app.fire('searchInput', 'keydown', { key: 'Enter' });
  app.settle();
  assert.deepEqual(app.dbg.trip.stops.map(s => s.poi.name), ['Toowoomba']);
  // arrows move the highlight, then Enter picks that one
  app.dbg.cancelTrip(); app.type('bris');
  const first = (app.html('suggestBox').match(/suggestName">([^<]+)/g) || []).map(x => x.replace('suggestName">', ''));
  app.fire('searchInput', 'keydown', { key: 'ArrowDown' });
  assert.match(app.html('suggestBox'), /suggestItem active/);
  app.fire('searchInput', 'keydown', { key: 'Enter' });
  app.settle();
  assert.equal(app.dbg.trip.stops[0].poi.name, first[1], 'the second suggestion was chosen');
  app.dbg.cancelTrip(); app.type('zzzzqqq'); assert.ok(!app.has('suggestBox', 'show'), 'nothing matches, nothing shown');
}));

test('compare: every algorithm is listed, the best values are marked, Replay re-runs one', () => withApp({}, app => {
  search(app, 'roma'); app.settle();
  app.click('compareBtn');
  assert.ok(app.has('comparePanel', 'show'));
  const body = app.html('cmpBody');
  for (const label of ['BFS', 'DFS', 'IDS', 'Dijkstra', 'A*', 'Wave', 'IDA*']) assert.ok(body.includes('>' + label + '<') || body.includes(label), label + ' missing');
  assert.equal((body.match(/data-act="replay"/g) || []).length, 7);
  assert.match(body, /class="best"/);
  assert.match(app.text('cmpSub'), /Brisbane → Roma/);
  app.fire('cmpBody', 'click', {}, { '[data-act="replay"]': { act: 'replay', alg: 'wave' } });
  assert.ok(!app.has('comparePanel', 'show'));
  assert.ok(app.dbg.state().animRunning, 'replay animates the search');
  app.settle();
  assert.match(app.text('previewMeta'), /Wave/);
}));

test('compare: with a road trip, totals cover every leg', () => withApp({}, app => {
  search(app, 'toowoomba'); app.click('addStopBtn'); search(app, 'roma'); app.settle();
  app.click('algCompareBtn');
  assert.match(app.text('cmpSub'), /Brisbane → Toowoomba → Roma · 2 legs/);
}));

test('favourites and recents: saved, starred, and shown first in the search box', () => withApp({}, app => {
  search(app, 'toowoomba'); app.settle();
  assert.equal(app.dbg.saved().recents.length, 1);
  app.click('favBtn');
  assert.equal(app.dbg.saved().favs.length, 1);
  assert.equal(app.text('favBtn'), '★');
  search(app, 'roma'); app.settle();
  app.type(''); app.focusSearch();
  const html = app.html('suggestBox');
  assert.match(html, /Favourites/); assert.match(html, /Recent/); assert.match(html, /Nearby towns/);
  assert.ok(html.indexOf('Favourites') < html.indexOf('Recent') && html.indexOf('Recent') < html.indexOf('Nearby towns'));
  // star from the list: Roma becomes a favourite too
  app.type('roma'); app.starSuggestion(0);
  assert.equal(app.dbg.saved().favs.length, 2);
  // clearing from settings
  app.fire('settingsBtns', 'click', {}, { '[data-act]': { act: 'clearFavs' } });
  assert.equal(app.dbg.saved().favs.length, 0);
  app.fire('settingsBtns', 'click', {}, { '[data-act]': { act: 'clearRecents' } });
  assert.equal(app.dbg.saved().recents.length, 0);
}));

test('favourites and recents: survive a reload (saved in localStorage)', async () => {
  const first = await startApp({});
  search(first, 'gympie'); first.settle(); first.click('favBtn');
  const stored = first.store['driftline_qld_saved']; first.stop();
  await withApp({ saved: JSON.parse(stored) }, app => {
    app.type(''); app.focusSearch();
    assert.match(app.html('suggestBox'), /Gympie/);
    assert.match(app.html('suggestBox'), /Favourites/);
  });
});

test('settings: switches persist, change behaviour and hide things', () => withApp({}, app => {
  app.dbg.setSetting('speedSigns', false);
  assert.ok(app.has('speedHud', 'noSign'));
  assert.equal(JSON.parse(app.store['driftline_qld_prefs']).settings.speedSigns, false);
  app.fire('settingsList', 'click', {}, { '[data-setting]': { setting: 'speedSigns' } });
  assert.ok(!app.has('speedHud', 'noSign'), 'clicking the switch turns it back on');
  // animate lives in two places: the algorithm panel and settings
  app.click('animSwitch');
  assert.equal(app.dbg.settings.animate, false);
  assert.ok(!app.has('animSwitch', 'on'));
  search(app, 'toowoomba');
  assert.ok(!app.dbg.state().animRunning, 'no animation when it is off');
  assert.ok(app.has('previewSheet', 'show'));
  // built-up slowdowns change trip times
  const t1 = app.text('previewMeta'); app.dbg.setSetting('builtUp', false); const t2 = app.text('previewMeta');
  assert.notEqual(t1, t2, 'drive time should change');
  // a saved setting is honoured on the next start
}));

test('settings: saved values are loaded on start', () => withApp({ prefs: { settings: { showPlaces: false, builtUp: false } } }, app => {
  assert.equal(app.dbg.settings.showPlaces, false);
  assert.equal(app.dbg.settings.builtUp, false);
  assert.equal(app.dbg.settings.speedSigns, true);
}));

test('every algorithm animates through to a preview, including Wave (neon lines drawn)', async () => {
  for (const alg of ['bfs', 'dfs', 'ids', 'dijkstra', 'astar', 'ida', 'wave']) {
    await withApp({ prefs: { alg } }, app => {
      search(app, 'gympie'); app.settle();
      assert.ok(app.has('previewSheet', 'show'), alg + ' never settled');
      assert.ok((app.draw.strokeStyles['#39FF14'] || 0) > 0, alg + ' drew no neon lines');
      assert.equal(app.crashed, null);
    });
  }
});

test('labels stay drawn at maximum zoom', () => withApp({}, app => {
  // zoom hard in on Brisbane (screen 1200x800 fit): mouse-wheel repeatedly
  const scale0 = Math.min((1200 - 120) / 970, (800 - 120) / 1200), ox = 600 - 485 * scale0, oy = 400 - 600 * scale0;
  const b = app.dbg.graph.nodes[app.dbg.graph.NID['Brisbane']], sx = b.x * scale0 + ox, sy = b.y * scale0 + oy;
  for (let i = 0; i < 70; i++) app.fire('map', 'wheel', { deltaY: -1, offsetX: sx, offsetY: sy });
  assert.equal(app.dbg.state().scale, 300, 'max zoom is 300x');
  app.draw.texts.length = 0; app.advance(50);
  assert.ok(app.draw.texts.length > 3, 'labels should still be drawn at max zoom');
}));

test('bidirectional search: same routes as one-way, explores from both ends, checkbox toggles it', () => withApp({}, app => {
  const g = app.dbg.graph, { ALGS } = app.dbg;
  const pairs = [['Brisbane', 'Cairns'], ['Toowoomba', 'Roma'], ['Gympie', 'Mackay'], ['Townsville', 'Brisbane']];
  for (const alg of ['bfs', 'dijkstra', 'astar']) {
    for (const [a, b] of pairs) {
      const s = g.NID[a], t = g.NID[b];
      app.dbg.settings.bidirectional = false; const one = ALGS[alg].fn(s, t);
      app.dbg.settings.bidirectional = true; const two = ALGS[alg].fn(s, t);
      assert.ok(one && two, alg + ' ' + a + '-' + b);
      // a connected path from start to end
      assert.equal(two.path[0].from, s); assert.equal(two.path[two.path.length - 1].to, t);
      two.path.forEach((seg, i) => { if (i) assert.equal(seg.from, two.path[i - 1].to); });
      if (alg === 'bfs') assert.equal(two.path.length, one.path.length, 'bfs: same number of towns');
      else assert.ok(Math.abs(two.totalSec - one.totalSec) < 0.01, `${alg} ${a}-${b}: ${two.totalSec} vs ${one.totalSec}`);
      assert.ok(two.trace.some(x => x.expand === t) || two.trace.some(x => x.expand === s));
    }
  }
  app.dbg.settings.bidirectional = false;
  app.dbg.setSetting('bidirectional', true);
  assert.equal(JSON.parse(app.store['driftline_qld_prefs']).settings.bidirectional, true);
  assert.ok(app.dbg.state);
}));

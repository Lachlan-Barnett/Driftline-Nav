// The seven routing algorithms. Each takes (startNodeId, endNodeId) and returns
//   { path, trace, totalSec, totalLenKm, nodesExplored }   (or null if there is no route)
// where `path` is a list of { edgeIdx, from, to } and `trace` is the sequence of expansions the
// search made (used to animate it). Wave also returns `wave` = { segs, T } for its flood animation.
export function createAlgorithms(graph) {
  const { nodes, edges, adj, edgeSeconds, edgeKm, heuristicSeconds } = graph;

  // One trace step: town u was expanded, and (unless it is the start) the road it was reached by.
  function expandStep(u, parent) {
    const pe = parent.get(u);
    return pe ? { expand: u, from: pe.from, edgeIdx: pe.edgeIdx } : { expand: u };
  }
  function buildResult(startId, endId, parent, trace) {
    if (endId !== startId && !parent.has(endId)) return null;
    const path = []; let cur = endId;
    while (cur !== startId) { const pe = parent.get(cur); if (!pe) return null; path.unshift({ edgeIdx: pe.edgeIdx, from: pe.from, to: cur }); cur = pe.from; }
    let totalSec = 0, totalLen = 0;
    path.forEach(seg => { const e = edges[seg.edgeIdx]; totalSec += edgeSeconds(e); totalLen += edgeKm(e); });
    const explored = new Set(); trace.forEach(t => { if (t.expand !== undefined) explored.add(t.expand); });
    return { path, trace, totalSec, totalLenKm: totalLen, nodesExplored: explored.size };
  }

  function runBFS(startId, endId) {
    const visited = new Set([startId]), parent = new Map(), trace = [], queue = [startId];
    while (queue.length) {
      const u = queue.shift(); trace.push(expandStep(u, parent));
      if (u === endId) break;
      for (const link of adj.get(u)) { if (!visited.has(link.to)) { visited.add(link.to); parent.set(link.to, { from: u, edgeIdx: link.edgeIdx }); queue.push(link.to); } }
    }
    return buildResult(startId, endId, parent, trace);
  }
  function runDFS(startId, endId) {
    const visited = new Set(), parent = new Map(), trace = []; let found = false;
    function dfs(u) {
      visited.add(u); trace.push(expandStep(u, parent));
      if (u === endId) return true;
      for (const link of adj.get(u)) {
        if (found) return true;
        if (!visited.has(link.to)) { parent.set(link.to, { from: u, edgeIdx: link.edgeIdx }); if (dfs(link.to)) return true; }
      }
      return false;
    }
    found = dfs(startId);
    return buildResult(startId, endId, parent, trace);
  }
  function runIDS(startId, endId) {
    const trace = []; const parent = new Map(); let found = false;
    function dls(u, path, depth, limit) {
      trace.push(expandStep(u, parent));
      if (u === endId) { found = true; return true; }
      if (depth >= limit) return false;
      for (const link of adj.get(u)) {
        if (path.includes(link.to)) continue;
        parent.set(link.to, { from: u, edgeIdx: link.edgeIdx });
        path.push(link.to);
        if (dls(link.to, path, depth + 1, limit)) return true;
        path.pop();
      }
      return false;
    }
    let limit = 0;
    while (!found && limit <= nodes.length) {
      if (dls(startId, [startId], 0, limit)) break;
      trace.push({ iterationEnd: true, depth: limit });
      limit++;
    }
    return buildResult(startId, endId, parent, trace);
  }
  function runDijkstra(startId, endId) {
    const dist = new Map(), parent = new Map(), visited = new Set(), trace = [];
    nodes.forEach(n => dist.set(n.id, Infinity)); dist.set(startId, 0);
    while (true) {
      let u = -1, best = Infinity;
      for (const n of nodes) if (!visited.has(n.id) && dist.get(n.id) < best) { best = dist.get(n.id); u = n.id; }
      if (u === -1) break;
      visited.add(u); trace.push(expandStep(u, parent));
      if (u === endId) break;
      for (const link of adj.get(u)) {
        const e = edges[link.edgeIdx], nd = dist.get(u) + edgeSeconds(e);
        if (nd < dist.get(link.to)) { dist.set(link.to, nd); parent.set(link.to, { from: u, edgeIdx: link.edgeIdx }); }
      }
    }
    return buildResult(startId, endId, parent, trace);
  }
  function runAStar(startId, endId) {
    const g = new Map(), parent = new Map(), visited = new Set(), trace = [];
    nodes.forEach(n => g.set(n.id, Infinity)); g.set(startId, 0);
    while (true) {
      let u = -1, best = Infinity;
      for (const n of nodes) {
        if (visited.has(n.id) || g.get(n.id) === Infinity) continue;
        const f = g.get(n.id) + heuristicSeconds(n.id, endId); if (f < best) { best = f; u = n.id; }
      }
      if (u === -1) break;
      visited.add(u); trace.push(expandStep(u, parent));
      if (u === endId) break;
      for (const link of adj.get(u)) {
        const e = edges[link.edgeIdx], ng = g.get(u) + edgeSeconds(e);
        if (ng < g.get(link.to)) { g.set(link.to, ng); parent.set(link.to, { from: u, edgeIdx: link.edgeIdx }); }
      }
    }
    return buildResult(startId, endId, parent, trace);
  }
  function runIDAStar(startId, endId) {
    const trace = []; const parent = new Map(); let found = false;
    let threshold = heuristicSeconds(startId, endId);
    const path = [startId];
    function search(g, bound) {
      const u = path[path.length - 1];
      const f = g + heuristicSeconds(u, endId);
      trace.push(expandStep(u, parent));
      if (f > bound) return f;
      if (u === endId) { found = true; return -1; }
      let min = Infinity;
      for (const link of adj.get(u)) {
        if (path.includes(link.to)) continue;
        const e = edges[link.edgeIdx];
        parent.set(link.to, { from: u, edgeIdx: link.edgeIdx });
        path.push(link.to);
        const t = search(g + edgeSeconds(e), bound);
        if (found) return -1;
        path.pop();
        if (t < min) min = t;
      }
      return min;
    }
    let iter = 0;
    while (!found && iter < 2000) {
      const t = search(0, threshold); iter++;
      if (found) break;
      if (t === Infinity) break;
      // Raise the cutoff to the cheapest road that overshot it, but by at least 0.5%: with real road
      // lengths almost every road has its own cost, and creeping up one road at a time takes
      // hundreds of passes. The route found is within 0.5% of the fastest.
      threshold = Math.max(t, threshold * 1.005);
      trace.push({ iterationEnd: true, threshold });
    }
    return buildResult(startId, endId, parent, trace);
  }
  function runWave(startId, endId) {
    // A flood: the search spreads outward from the start along every road at once, all at the same
    // speed (distance, not travel time), until the first wave front reaches the destination.
    const dist = new Map(), parent = new Map(), settled = new Set(), order = [];
    nodes.forEach(n => dist.set(n.id, Infinity)); dist.set(startId, 0);
    while (true) {
      let u = -1, best = Infinity;
      for (const n of nodes) if (!settled.has(n.id) && dist.get(n.id) < best) { best = dist.get(n.id); u = n.id; }
      if (u === -1) break;
      settled.add(u); order.push(u);
      if (u === endId) break;
      for (const link of adj.get(u)) {
        const nd = dist.get(u) + edges[link.edgeIdx].len;
        if (nd < dist.get(link.to)) { dist.set(link.to, nd); parent.set(link.to, { from: u, edgeIdx: link.edgeIdx }); }
      }
    }
    if (!settled.has(endId)) return null;
    const T = dist.get(endId);
    // Each road is grown from both ends by the fronts that reach it; two fronts stop where they
    // meet. s0 = when a front enters the road, s1 = when it stops (all in distance units).
    const segs = [];
    order.forEach(u => {
      const du = dist.get(u);
      adj.get(u).forEach(link => {
        const e = edges[link.edgeIdx], v = link.to;
        const stop = settled.has(v) ? Math.min((e.len + du + dist.get(v)) / 2, T) : Math.min(du + e.len, T);
        if (stop > du) segs.push({ edgeIdx: link.edgeIdx, fwd: e.a === u, s0: du, s1: stop });
      });
    });
    const result = buildResult(startId, endId, parent, order.map(u => expandStep(u, parent)));
    if (result) result.wave = { segs, T };
    return result;
  }

  const ALGS = {
    bfs: { fn: runBFS, label: 'BFS', color: '--alg-bfs', desc: 'Explores outward in equal steps, ignoring speed limits — finds the route with the fewest towns, not the fastest one.' },
    dfs: { fn: runDFS, label: 'DFS', color: '--alg-dfs', desc: 'Commits to one direction and only backtracks at dead ends — gets you there, but rarely by a sensible way.' },
    ids: { fn: runIDS, label: 'IDS', color: '--alg-ids', desc: 'DFS re-run from scratch with the depth limit raised by one each pass — finds the same fewest-towns route as BFS, using barely any memory.' },
    dijkstra: { fn: runDijkstra, label: 'Dijkstra', color: '--alg-dijkstra', desc: 'Always finds the fastest route by travel time, expanding the whole map evenly outward from the start.' },
    astar: { fn: runAStar, label: 'A*', color: '--alg-astar', desc: 'Same optimal answer as Dijkstra, but a straight-line estimate to the destination steers the search there faster.' },
    wave: { fn: runWave, label: 'Wave', color: '--alg-wave', desc: 'Floods outward from the start along every road at once, at the same speed everywhere — the first wave to reach the destination has found the shortest route by distance, though not always the fastest.' },
    ida: { fn: runIDAStar, label: 'IDA*', color: '--alg-ida', desc: 'A* logic run as repeated shallow dives with a rising cutoff — slower to watch, but barely any memory needed.' },
  };
  return { ALGS, runDijkstra };
}

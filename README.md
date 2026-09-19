# Driftline — Queensland Nav

A Waze-style stylised navigation demo for Queensland, Australia: search and
drive between towns, watch different pathfinding algorithms (BFS, DFS, IDS,
Dijkstra, A*, IDA*) search the map live, get turn-by-turn directions, and
report police/hazards/crashes along the way.

## Running it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

To build a production bundle:

```bash
npm run build
npm run preview   # serve the built files locally to check them
```

## How this project is put together

This started as a single self-contained HTML file (canvas map + vanilla JS).
It's now a proper Vite + React project so it opens and runs in VS Code like
any other React app, but it's worth knowing how it's structured underneath:

- `src/markup.js` — the app's DOM structure (all the panels, buttons, the
  canvas element), lifted verbatim from the original page and injected once
  via `dangerouslySetInnerHTML` in `App.jsx`.
- `src/driftline.js` — all of the app's behavior: the road network, the six
  routing algorithms, the canvas rendering loop, drag/pinch/zoom handling,
  the reports system, preferences, everything. It's exported as a single
  `initDriftline()` function that wires itself up with ordinary
  `getElementById`/`querySelector` calls, the same way it did as a static
  page — it was never written against React state.
- `src/App.jsx` — a thin wrapper: it renders the markup, then calls
  `initDriftline()` once in a `useEffect` after mount, and returns its
  cleanup function (which cancels the animation loop and removes the
  window/document-level listeners it added).
- `src/App.css` — the app's styling, unchanged.

**Why one big module instead of small components:** breaking this into
`<RouteAlgorithmPanel>`, `<ReportsFab>`, `<DriveHud>`, etc. and moving its
state into `useState`/hooks would be a substantial rewrite of logic that's
already tuned (gesture handling, animation timing, panel open/close
choreography) — worth doing deliberately, not as a side effect of a format
change. This structure gets you a real React project you can run, build,
and keep editing in VS Code today. Splitting it into components is a
reasonable next step if you want to take it further — the file is organized
in commented sections (PROJECTION, ROADS, ROUTE ALGORITHMS, CANVAS/CAMERA,
HAZARDS, REPORT FAB, ADMIN PANEL, THEME, SEARCH, ROUTE/NAV STATE, MAIN LOOP)
that map fairly directly onto what would become separate components/hooks.

## Notes

- All state (theme, chosen algorithm, animate-search toggle, active reports)
  persists to the browser's `localStorage`, so it survives refreshes.
- The map is a stylised representation of Queensland, not real map-tile data:
  195 towns are placed by their real latitude/longitude, the state outline
  (coast, Gulf of Carpentaria, and the NT/SA/NSW borders) is hand-traced from
  real coordinates, and the 228 roads between towns follow their real shape
  (see `roads.json`). Town labels appear by size as you zoom in (up to 300x).
- `src/data/roads.json` holds the real driving route of every road as
  `[lat, lon]` points (one road per line), taken from OpenStreetMap via the
  public OSRM router and simplified to ~30 m. Road lengths and drive times come
  from these shapes. The local roads to the extra places are still straight
  lines.
- `src/data/places.json` holds ~4,000 extra places (towns, villages, hamlets,
  suburbs and rural localities) from OpenStreetMap (© OpenStreetMap contributors, ODbL). Each is linked to its
  nearest neighbour by a local road (a minimum spanning tree grown outward
  from the towns), drawn as a dotted line. They're searchable and tappable, but
  only join the routing graph when picked: that adds the place and its chain of
  local roads, so all six algorithms can route to it.
- `src/data/speeds.json` holds a speed limit for every road, taken from the
  signed `maxspeed` values in OpenStreetMap (length-weighted most common limit
  along each road). Roads OSM has no limit for use Queensland's 100 km/h
  default, or 80 km/h if they are mostly unsealed. Both files are one-off
  snapshots (fetched 19 Sep 2026); they don't update by themselves.

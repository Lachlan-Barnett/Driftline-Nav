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
- The map is a stylised, procedurally-laid-out representation of
  Queensland's major towns and highways — not real GPS/map-tile data.

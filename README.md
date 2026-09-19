# Driftline — Queensland Nav

A Waze-style stylised navigation demo for Queensland, Australia. Search and drive between 190+
towns and 4,000+ suburbs, villages and hamlets, plan **road trips** with several stops, watch seven
pathfinding algorithms (BFS, DFS, IDS, Dijkstra, A\*, IDA\*, Wave) search the map live as glowing
neon-green lines, **compare** them side by side, get turn-by-turn directions with **speed limit
signs**, and report police / hazards / crashes that slow the roads they're on.

What has changed over time is written down in [`CHANGELOG.md`](CHANGELOG.md).

## Running it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually `http://localhost:5173`).

```bash
npm run build      # production bundle in dist/
npm run preview    # serve the built files locally to check them
npm test           # 33 tests: map logic + the real app in a fake browser
npm run shots      # real screenshots in headless Chrome/Edge -> tests/.shots/
npm run data:all   # rebuild every data file from OpenStreetMap (see scripts/README.md)
```

## Using it

- **Search** for a place, or tap a town on the map (zoom in and suburbs, villages and localities appear
  too; zoom goes up to 300×). The first result is the exact match, then names that start with what you
  typed, then the nearest.
- **Road trip**: once you have a destination, press **+** (*Add destination*) and search another. The trip
  panel lets you reorder stops (drag the grip, or use ▲ ▼) and remove them. Each leg (start → stop 1 →
  stop 2 …) is searched independently and animated in turn.
- **Start location**: long-press (or right-click) the map and choose *Set start here*, or tap the *Start* row
  of the trip panel and pick a place. The pin snaps to the nearest road.
- **Algorithms** (the branching-lines button): BFS, DFS, IDS, Dijkstra, A\*, IDA\* and Wave. **Compare
  all algorithms** shows towns explored, search steps, distance and drive time for each, with a *Replay*
  button per algorithm.
- **Drive**: speed limit sign and current speed (bottom left), time / distance / arrival (bottom middle),
  reports (bottom right). The limit drops through built-up areas.
- **Reports**: the yellow triangle reports police, a hazard or a crash at your position; long-press the map
  to report anywhere. Reports slow the road they're on (crash +25 min, hazard +8, police +3) and disappear
  after 20 minutes. Mid-drive you're offered a faster route if one exists.
- **Favourites and recents**: star a destination; the empty search box lists favourites, recents and nearby
  towns.
- **Settings** (hamburger menu): speed limit signs, built-up slowdowns, avoid reports when routing, offer
  reroutes, show suburbs / villages / local roads, animate the search, clear recents / favourites, dark mode.
  Everything is saved in the browser's `localStorage`.

## How the project is put together

```
src/
  driftline.js     the interface: canvas drawing, camera, search, trip planner, navigation,
                   reports, settings. Exported as initDriftline(), called once by App.jsx.
  graph.js         the road graph: towns, roads with real shapes, coastline, extra places and their
                   local roads, speed zones, report delays, splitting a road for a start pin.
                   Pure (no DOM), so tests and scripts can use it.
  algorithms.js    the seven routing algorithms, on top of graph.js. Also pure.
  projection.js    latitude/longitude -> map units (shared with the scripts).
  markup.js        the page structure, injected once by App.jsx.
  App.jsx, main.jsx, App.css
  data/
    network.js       the 195 towns and 228 roads (hand-written data, one per line)
    roads.json       real driving shape of each road         } generated from OpenStreetMap
    speeds.json      signed speed limit of each road         } by scripts/ (npm run data:*)
    coast.json       real coastline: mainland + 140 islands  }
    places.json      ~4,050 suburbs / villages / hamlets…    }
    local-roads.json the local road linking each place in    }
scripts/           the data pipeline (see scripts/README.md)
tests/             graph.test.mjs, app.test.mjs, lib/, visual/shots.mjs (see tests/README.md)
CHANGELOG.md       every change, addition and deletion
```

**One idea to keep in mind:** the graph is mutable. Picking a suburb adds it (and the chain of local roads
leading back to a town) as nodes and edges, and dropping a start pin splits a road in two. The algorithms
only ever see the towns plus whatever you've touched, which keeps them fast.

App.jsx renders `markup.js` once and calls `initDriftline()` after mount; that function wires everything
up with ordinary `getElementById` calls and returns a cleanup function (cancels the animation loop and
removes the window / document listeners). It was never written against React state, so the interface is
one module rather than a tree of components. Splitting it into components is a reasonable next step;
`driftline.js` is organised in commented sections (PREFERENCES, GRAPH, CANVAS / CAMERA, PAN / ZOOM,
HAZARDS, REPORT FAB, ADMIN PANEL, THEME, ALGORITHM PANEL, MENU + SETTINGS, FAVOURITES, SEARCH, TRIP STATE,
trip panel, preview sheet, COMPARE, LONG-PRESS MENU, NAVIGATION, MAIN LOOP) that map onto what would become
separate components or hooks.

## The data

The map is a stylised map of Queensland, not map tiles:

- **Towns** (`network.js`) are placed by real latitude/longitude; **roads** follow their real route
  (`roads.json`, from OSRM) with their signed speed limit (`speeds.json`, from OpenStreetMap `maxspeed`
  tags; roads OSM has no limit for use Queensland's 100 km/h default, or 80 if mostly unsealed).
- The **coastline** (`coast.json`) is the real OpenStreetMap coastline. The NSW / SA / NT borders are
  hand-traced straight-ish lines.
- **Extra places** (`places.json`) are rows of `[name, lat, lon, kind]` with kind `city`, `town`,
  `village`, `hamlet`, `suburb` or `locality`. Each hangs off its nearest neighbour by a local road
  (`local-roads.json`: parent + real shape), drawn as a dotted line and added to the routing graph when
  picked.
- Built-up areas slow the road at each end of a town (60 km/h around big towns, 50 around small ones);
  local roads carry 50 km/h in suburbs and 80 km/h elsewhere. These are estimates, not signed limits.
- All of this is a **one-off snapshot** of OpenStreetMap (© OpenStreetMap contributors, ODbL), taken on
  19 Sep 2026. Rebuild it with `npm run data:all`. Some roads (mostly the outback ones) and 288 of the
  local roads have no known shape and are straight lines.
- Drive times are limits and slowdowns only: no stops, no traffic beyond your own reports.

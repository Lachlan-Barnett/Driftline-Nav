# Driftline — Queensland Nav

A stylised navigation demo for Queensland, Australia. Search and drive between 190+
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

Then open the URL the dev server prints (usually `http://localhost:5173`).

```bash
npm run build      # production bundle in dist/
npm run preview    # serve the built files locally to check them
npm test           # 40 tests: map logic + the real app in a fake browser
npm run shots      # real screenshots in a headless browser -> tests/.shots/
npm run perf       # redraw time and idle CPU in a headless browser
npm run data:all   # rebuild every data file from open map data (see scripts/README.md)
```

## Using it

- **Search** for a place, or tap a town on the map (zoom in and suburbs, villages and localities appear
  too; zoom goes up to 300×). Case, abbreviations (*Mt*, *St*) and one typo are forgiven; Enter picks the top
  result, ↑ / ↓ move the highlight. Real towns rank above obscure localities.
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
  to report anywhere. Reports slow the road they're on **in the direction you were driving** (crash +25 min, hazard +8, police +3) and
  disappear after 20 minutes. While driving you're only told about reports ahead of you, on your route and
  in your direction. Mid-drive you're offered a faster route if one exists.
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
                   side roads, junctions, speed zones, direction-aware report delays, splitting a road for a
                   start pin or a place on a road.
                   Pure (no DOM), so tests and scripts can use it.
  algorithms.js    the seven routing algorithms, on top of graph.js. Also pure.
  projection.js    latitude/longitude -> map units (shared with the scripts).
  markup.js        the page structure, injected once by App.jsx.
  App.jsx, main.jsx, App.css
  data/
    network.js       the 195 towns and 228 roads (hand-written data, one per line)
    roads.json       real driving shape of each road         } generated from open map data
    speeds.json      signed speed limit of each road         } by scripts/ (npm run data:*)
    coast.json       real coastline: mainland + 140 islands  }
    places.json      ~4,050 suburbs / villages / hamlets…    }
    junctions.json   where roads that share a stretch fork   }
    local-roads.json where each place joins the road network }
scripts/           the data pipeline (see scripts/README.md)
tests/             graph.test.mjs, app.test.mjs, lib/, visual/shots.mjs, visual/perf.mjs (see tests/README.md)
CHANGELOG.md       every change, addition and deletion
```

**One idea to keep in mind:** the graph is mutable. Picking a suburb adds it to the road it is on (splitting that road there) or
adds it at the end of its side road, and dropping a start pin splits a road in two. The algorithms
only ever see the towns plus whatever you've touched, which keeps them fast.

App.jsx renders `markup.js` once and calls `initDriftline()` after mount; that function wires everything
up with ordinary `getElementById` calls and returns a cleanup function (cancels the animation loop and
removes the window / document listeners). It was never written against component state, so the interface is
one module rather than a tree of components. Splitting it into components is a reasonable next step;
`driftline.js` is organised in commented sections (PREFERENCES, GRAPH, CANVAS / CAMERA, PAN / ZOOM,
HAZARDS, REPORT FAB, ADMIN PANEL, THEME, ALGORITHM PANEL, MENU + SETTINGS, FAVOURITES, SEARCH, TRIP STATE,
trip panel, preview sheet, COMPARE, LONG-PRESS MENU, NAVIGATION, MAIN LOOP) that map onto what would become
separate components or hooks.

## The data

The map is a stylised map of Queensland, not map tiles:

- **Towns** (`network.js`) are placed by real latitude/longitude; **roads** follow their real route
  (`roads.json`, from a public routing service) with their signed speed limit (`speeds.json`, from the map database's `maxspeed`
  tags; roads with no signed limit use Queensland's 100 km/h default, or 80 if mostly unsealed).
- The **coastline** (`coast.json`) is the real coastline (open map data). The NSW / SA / NT borders are
  hand-traced straight-ish lines.
- **Extra places** (`places.json`) are rows of `[name, lat, lon, kind]` with kind `city`, `town`,
  `village`, `hamlet`, `suburb` or `locality`. Each is attached to the **road network** (`local-roads.json`): either it is on a main road (the
  road is split at the place), or a real side road leads to it from the junction where it leaves a main
  road (drawn dotted). Places never link to each other. Where roads share a stretch out of a town they fork at
  a real junction (`junctions.json`).
- Built-up areas slow the road at each end of a town (60 km/h around big towns, 50 around small ones);
  local roads carry 50 km/h in suburbs and 80 km/h elsewhere. These are estimates, not signed limits.
- All of this is a **one-off snapshot** of open map data (© OpenStreetMap contributors, ODbL: the credit that licence requires, also shown in the map footer), taken on
  19 Sep 2026. Rebuild it with `npm run data:all`. Some roads (mostly the outback ones) and 107 of the
  side roads have no known shape and are straight lines.
- Drive times are limits and slowdowns only: no stops, no traffic beyond your own reports.

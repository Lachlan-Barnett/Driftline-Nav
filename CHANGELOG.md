# Changelog

Everything that has been added, changed, removed or fixed in Driftline, newest first. Each round is
one batch of requests; none of this touches git history: commits and branches are managed by hand.

Branches on the remote: `main` and `node_line_search` carry the neon line search and Wave;
`node_dot_search` keeps the original dot search (it predates Wave and everything below).

---

## Round 8: trips, start pins, speed signs, real coast, tests and data scripts

### Added
- **Red user marker.** The user (the car arrow, both idle and while driving, and its idle pulse) and the
  trip panel's Start pin are red (`--user` in `App.css`); they were blue / teal.
- **Purple route line.** The route that was found is drawn in purple (`--path` in `App.css`, a darker
  violet in the day theme) so it contrasts with the neon-green search lines. Stop markers, the car and the
  turn icon keep the teal accent.
- **Road trips.** A **+** button next to the search bar (tooltip: *Add destination*) adds another stop.
  A trip panel lists Start and every stop, numbered, with up/down arrows, drag-to-reorder and remove
  buttons. **Every leg is searched independently** (start → stop 1 → stop 2 …) with the chosen
  algorithm; legs already searched are reused and only new legs animate, earlier legs stay on the map
  dimmed. Stops get numbered markers. Driving a trip pauses briefly at each waypoint ("Stop 1
  reached"), the trip info shows "Stop 2 of 3 · Ipswich", and the trip finishes at the last stop.
- **Pick your start location.** Long-press (or right-click) the map → *Set start here*: the pin snaps to the
  nearest road, which is split in two at that point. Or tap the **Start** row of the trip panel and search
  or tap a place. The car (and every route) now starts from there instead of always from Brisbane.
- **Long-press / right-click menu**: set start, *Go to* / *Add as a stop* for the town or place under the
  pointer, and report a crash, hazard or police **at that spot** (snapped to the road).
- **Speed limit signs.** A speed HUD (bottom left) shows the Australian-style limit sign for the road you
  are on plus your current speed. The limit drops through **built-up areas** (60 km/h around big towns,
  50 km/h around small ones, and 50 km/h on suburb streets); the same slowdowns are in every drive-time
  estimate.
- **Reports now matter.** A crash adds 25 min to the road it is on, a hazard 8 min, police 3 min (capped at
  60 min per road). Routing goes round them when it is faster, the preview notes "includes about N min of
  delays from reports", and **while driving** you are offered a faster route when a report appears ahead
  (*Reroute* / *Keep route*).
- **Compare all algorithms.** A table of BFS, DFS, IDS, Dijkstra, A*, Wave and IDA* for your trip (towns
  explored, search steps, distance, drive time, best value in each column highlighted) with a **Replay**
  button that animates that algorithm's search. Open it from the preview sheet or the algorithm panel.
- In the compare panel the algorithm currently in use is shown in **purple** text; the little "current"
  tag is gone.
- **Favourites and recent destinations.** Star any result (or the destination in the preview); the search
  box shows *Favourites*, *Recent* and *Nearby towns* when empty. Stored in the browser.
- **Settings** (hamburger menu): speed limit signs, slower speeds in built-up areas, avoid reports when
  routing, offer reroutes while driving, show suburbs / villages / local roads, animate the search, plus
  *Clear recent destinations* and *Clear favourites*. Saved in the browser.
- **Real coastline** (`src/data/coast.json`): Queensland's coast and 140 islands from open map data,
  replacing the hand-traced outline. The NSW / SA / NT borders are still hand-traced.
- **Real shapes for the local roads** (`src/data/local-roads.json`): each suburb / village / hamlet /
  locality is linked to the network by a road that follows the real street layout (3,762 of 4,050 links
  have a real shape; the rest stay straight lines).
- **`src/graph.js`, `src/algorithms.js`, `src/projection.js`, `src/data/network.js`**: the map logic
  split out of the UI file so it can be tested and reused by scripts (see *Changed*).
- **Data scripts** (`scripts/`, `npm run data:*`): every data file can be rebuilt from open map data.
  See `scripts/README.md`.
- **Tests** (`tests/`, `npm test`): 11 logic tests and 22 browser-level tests (real app code, fake DOM,
  virtual clock). `npm run shots` takes real screenshots in a headless browser.
- Test hook: when `window.__DRIFTLINE_DEBUG__` is set before start, the app exposes `window.__driftline`.
- `.gitignore`: `scripts/.cache`, `scripts/.tmp`, `tests/.shots`.
- Islands with real towns are now on the map: Palm Island, Thursday Island, Gununa (Mornington Island),
  Lizard Island, Hayman Island and others (`places.json` 3,990 → 4,050 places).

### Changed
- **Layout.** Speed HUD **bottom left**, reports **bottom right**, trip info (time left, km left,
  arrival, stop) **bottom middle** between them. The recentre button now sits **above the speed HUD**.
  The reports button no longer lifts off the corner during a drive. The map attribution moved to the
  bottom centre. Everything else is where it was.
- `driftline.js` is now only the interface (canvas, camera, search, trip planner, navigation, reports,
  settings): 1,569 lines → 1,396, with the map logic in the new modules.
- Towns and roads moved out of `driftline.js` into `src/data/network.js` (rows of data, one per line).
- `places.json` regenerated against the real coastline (see above) and `speeds.json` rebuilt by
  `scripts/fetch-speeds.mjs`, which matches map-database ways to each road by the road's real shape
  (one limit changed: Tiaro–Gympie 100 → 110).
- Local roads to places are now precomputed (`local-roads.json`) instead of being computed when the app
  starts: startup no longer builds a spanning tree.
- Opening the menu, algorithm panel, reports panel or the search box no longer cancels the route
  preview / trip (it used to, which made building a trip impossible). Cancel, or tapping empty map,
  does.
- The preview sheet gained a favourite star, a leg list, a delay note and a **Compare** button.
- The menu panel scrolls when it is taller than the screen.
- IDA* raises its cutoff by at least 0.5% per pass (see *Fixed*).
- Trip animations speed up when several legs animate at once so the preview appears in a few seconds.

### Removed
- The hand-traced Queensland outline and four hand-drawn islands (`MAINLAND_LL`, `ISLANDS_LL`).
- The runtime spanning-tree pass and the old "nearest town" access-road logic (replaced by data).
- The hard-coded `TOWN_DATA` list and the ~230 `road(...)` calls inside `driftline.js`.
- The 104 px lift of the reports button during drives, and the code that closed the preview whenever a
  panel opened.
- The speed readout from the drive HUD (it lives in the speed HUD now).
- The one-off scratch scripts that used to live outside the project: their logic is in `scripts/`.

### Fixed
- IDA* found no route on long trips (Brisbane → Cairns): with real road lengths there were hundreds of
  distinct cost values and it ran out of passes. Now bounded, and within 0.5% of the fastest route.
- Kowanyama's road no longer clips the Gulf coast; several roads that wrongly detoured through other
  towns were rewired onto their real links (earlier round, kept).

---

## Round 7: neon line search and the Wave algorithm

### Added
- **Neon-green line search animation.** The moving dot is gone: as the search expands a town, the road it
  was reached by lights up and grows along the real road shape.
- **Wave algorithm** (7th): floods outward from the start along every road at once, at the same speed
  everywhere; the first front to reach the destination has found the shortest route *by distance*.
  Driven by a shared clock so every road grows simultaneously. Result verified against an independent
  shortest-distance solver.
- Expansion steps in every algorithm now record the road they arrived by.

### Changed
- After a search finishes, the route is drawn on top of the (dimmed) search lines; previously the animated
  search hid the route until you pressed Start.
- Search animation plays several steps per tick so IDS / IDA* animations take a few seconds.

Branches: `main` = this version; `node_dot_search` = the dot animation, without Wave.

---

## Round 6: real road shapes, `kind` column, tidier data files

### Added
- **Real road shapes** (`src/data/roads.json`): every one of the 228 roads follows its real driving route
  (from a public routing service), simplified to ~30 m. Road lengths, drive times and the driving car all
  follow the real shape. Brisbane → Beaudesert now runs via Jimboomba and Woodhill.
- `places.json` has a readable **kind** column (`city`, `town`, `village`, `hamlet`, `suburb`,
  `locality`) instead of a numeric rank.
- Search puts an exact name first ("Cairns" before "Cairns City").

### Changed
- Road lengths and travel times now come from the real shapes (Brisbane → Cairns 1,802 km).
- Labels are drawn in screen pixels at a constant 12 px (see *Fixed*).
- Max zoom 64× → 300×.

### Fixed
- Town names disappeared at maximum zoom: the label font was sized in map units and rounded to 0 px.

---

## Round 5: suburbs, localities and local roads

### Added
- **Suburbs and rural localities** from open map data (891 + 2,232), taking `places.json` to ~4,000.
  Zoom deep to see them (suburb names from ~12×, locality names from ~24×).
- **Local roads** linking every place to the network, drawn as dotted lines (a minimum spanning tree grown
  outward from the towns); picking a place wires its whole chain of roads into the graph so all
  algorithms can route to it.
- 50 km/h on suburb streets, 80 km/h on rural local roads.

### Changed
- Max zoom 16× → 64×.
- `places.json` and `speeds.json` were reformatted to one entry per line.

---

## Round 4: open-map-data places and real speed limits

### Added
- **~870 extra towns, villages and hamlets** from open map data (`places.json`): searchable and tappable,
  added to the routing graph only when picked.
- **Per-road speed limits** (`speeds.json`) from signed `maxspeed` tags for all 228 roads (fallback:
  Queensland's 100 km/h default, or 80 km/h for mostly unsealed roads). Real limits: 110 on the Bruce
  Highway Gympie → Caboolture and the Flinders / Landsborough / Capricorn highways, 60–80 on the
  Tablelands roads.
- A © OpenStreetMap contributors credit on the map.

### Changed
- 167 of 195 town coordinates snapped to the map database's positions (none moved more than 8 km).
- The blanket 110 / 95 / 75 km/h speeds by road type were dropped.
- Labels: bigger towns win, smaller ones appear as you zoom in, overlapping labels are skipped.

---

## Round 3: 195 towns, deeper zoom

### Added
- 82 more towns (113 → 195) and 131 more roads, all on real highways, so routes pass through the
  towns they really pass through.
- A fourth label rank for the smallest towns.
- Zoom range 3.2× → 16×; dots, roads, route lines, the car and search circles stop growing past ~1.4×
  so they stay sensible at deep zoom.

### Changed
- 41 roads were split by the new towns (for example Cairns–Innisfail now goes via Gordonvale and Babinda).

---

## Round 2: a much more accurate Queensland

### Added
- A hand-traced outline from real coordinates: Cape York, the Gulf of Carpentaria, the east coast and the
  NT / SA / NSW borders, plus Fraser, Moreton, North Stradbroke and Mornington islands.
- 80 more towns (33 → 113) with real latitude/longitude and ranks, and roads along the real highway network.
- Town labels by rank with overlap avoidance.
- The mouse cursor becomes a pointer over a town.

### Changed
- The map projection was widened to Queensland's true proportions (`WORLD_W` 900 → 970) and
  `KM_PER_UNIT` 1.7 → 1.8.
- IDS / IDA* search animations play in batches; IDA*'s pass cap was raised (60 → 2,000).
- The menu text and README describe the new map.

### Removed
- The old 33-town, 4-edge-type outline and the `OUTLINE` polygon.

---

## Round 1: layout tweaks

### Changed
- New reports appear **exactly underneath the car** (the random offset was removed).
- The search bar is snapped to the left of the screen and the menu buttons to the right; the menu,
  algorithm and reports panels open under the right-hand buttons and the suggestion list under the
  search bar.

---

## Baseline (as first read)

A bundled web project wrapping a single-file canvas app: 33 Queensland towns, a stylised outline,
six routing algorithms (BFS, DFS, IDS, Dijkstra, A*, IDA*) animated as dots, turn-by-turn drive, a
police / hazard / crash report system with an admin panel, light and dark themes, pan / scroll / pinch
zoom, and preferences saved in `localStorage`.

# Tests

```bash
npm test          # both test files (about 30 seconds)
npm run shots     # real screenshots -> tests/.shots/ (git-ignored)
npm run perf      # redraw time and idle CPU of the real app in a headless browser
```

| File | What it covers |
| --- | --- |
| `graph.test.mjs` | **Logic, no browser.** Data integrity (towns unique, roads and their limits present, every town on land, every place attached to a road, junctions consistent, network connected); Dijkstra = A\*, IDA\* within 0.5%; BFS = IDS hop count; Wave = shortest by distance; built-up speed zones; direction-aware report delays and the "avoid reports" switch; start pins (splitting a road keeps it drivable and the same length); places attach to roads (Jimboomba is on the Mount Lindesay Highway); forks are real junctions. |
| `app.test.mjs` | **The real app in a fake browser.** Search ranking and kinds, the + button and trip building, independent legs, reordering (arrows and drag) and removing stops, dropping duplicates, start pins via the long-press menu and the trip panel, the speed HUD and limit sign, road-trip driving with waypoint stops, report delays, reports ahead / behind / oncoming, search (typos, abbreviations, Enter, arrows), reroute offers (offer, accept, keep route, switch off), compare and replay, favourites and recents (and persistence), settings, every algorithm animating with neon lines, labels at maximum zoom. |
| `lib/harness.mjs` | The fake browser: loads `src/driftline.js` through the bundler, provides a fake DOM, a virtual clock (`advance(ms)`) and records canvas drawing. |
| `lib/data.mjs` | Loads the data files from disk and builds a graph. |
| `visual/shots.mjs` | Launches a Chromium-based browser headless, drives the running app through the DevTools protocol and saves PNGs (desktop and phone sizes). For looking at, not asserting. |
| `visual/perf.mjs` | Same browser set-up; measures redraw time and idle CPU (browser process, via the DevTools protocol) in a few scenes. A number to compare before and after a change, not a pass / fail test. |

Tests never touch the network, and never call the data scripts; they use the files in `src/data/`.
The fake DOM can't check CSS or how things look: that's what `npm run shots` is for.

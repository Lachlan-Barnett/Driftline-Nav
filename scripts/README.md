# Data scripts

These rebuild the files in `src/data/` from open map data. The app never runs them: they exist so the
map data isn't a black box and can be refreshed.

```bash
npm run data:all                 # everything, in dependency order
npm run data:coast               # src/data/coast.json          (real coastline, mainland + islands)
npm run data:places              # src/data/places.json         (needs coast.json)
npm run data:roads               # src/data/roads.json          (real shape of each road)
npm run data:speeds              # src/data/speeds.json         (needs roads.json)
npm run data:local-roads         # src/data/local-roads.json    (needs places.json; ~15 minutes)
```

Add `--refresh` to any of them (`npm run data:roads -- --refresh`) to throw away the cached download and
fetch it again. Without it, downloads are reused from `scripts/.cache/` (git-ignored, ~15 MB), so a re-run
only fetches what is missing: new roads in `network.js`, for example.

| Script | Reads | Writes | Data comes from |
| --- | --- | --- | --- |
| `fetch-coast.mjs` | coastline ways from the map database | `coast.json` | open map data |
| `fetch-places.mjs` | place tags (city … locality), `coast.json`, `network.js` | `places.json` | open map data |
| `fetch-roads.mjs` | `network.js` | `roads.json` | a public routing service |
| `fetch-speeds.mjs` | named highways with `maxspeed` tags, `roads.json`, `network.js` | `speeds.json` | open map data |
| `fetch-local-roads.mjs` | `places.json`, `network.js` | `local-roads.json` | a public routing service |
| `data-all.mjs` | | | runs the five above in order |

The web addresses of the map database and the routing service are set in `lib/io.mjs`. The data is
© OpenStreetMap contributors (ODbL); the app's map footer carries the credit that licence requires.

## How each step works

- **Coast.** Coastline ways are directed with the land on their left. They're stitched into chains; the
  chain that runs from Point Danger (NSW border) round Cape York to the NT border in the Gulf is cut to
  Queensland and closed along the state borders (a hand-traced list in the script). Every closed ring
  bigger than 3 km² inside Queensland becomes an island. Simplified to ~120 m.
- **Places.** Everything already on the road network (same name, or within 1.5 km for a small settlement)
  is dropped, as are places off the coast, and near-duplicates. Rows are sorted city → locality then by name,
  so their position is stable: `local-roads.json` refers to places by row index.
- **Roads.** Each road in `ROADS` is routed between its two towns and simplified to ~30 m. Roads the router
  can't drive (e.g. Gregory Downs – Camooweal) are left out and drawn straight.
- **Speeds.** Every way whose name matches a road (the closest road of that name to the way, within
  30 km, judged by the road's real shape) votes for its limit, weighted by length. The winning signed limit
  is used if at least 20% of the road's length was tagged; otherwise 100, or 80 if mostly unsealed.
- **Local roads.** A minimum spanning tree is grown outward from the towns so each place hangs off its
  nearest neighbour (a town, or another place). Each link is then routed with the routing service, giving
  the real street path (links longer than 3.5× the straight line are dropped to straight). Progress is saved
  in `scripts/.cache/route-local.json` every 100 links, so an interrupted run resumes.

## Being polite to the public servers

The map database and the routing service are free community services. The scripts identify themselves with a
User-Agent, run 1–3 requests at a time with a pause between them, back off on `429` / `5xx`, and cache
everything. Please don't remove that. For a lot more than ~5,000 requests, run your own routing server.

## Layout

```
scripts/
  lib/io.mjs     cache, map-database / routing clients, one-row-per-line JSON writers
  lib/geo.mjs    distances, line simplification, polygon tests, ring area
  lib/text.mjs   edit text files without changing their line endings (repo files are CRLF on Windows)
  .cache/        downloaded data (git-ignored)
  .tmp/          scratch space for one-off scripts (git-ignored)
```

`scripts/*.mjs` import the app's own `src/data/network.js` and `src/projection.js`, so the data and the app
can't drift apart.

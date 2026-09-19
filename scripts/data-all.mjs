// Rebuilds every data file in src/data from open map data, in dependency order:
//
//   npm run data:all [-- --refresh]
//
// coast -> places (needs the coast) -> roads -> speeds (needs roads) -> local-roads (needs places).
// Downloads are cached in scripts/.cache, so without --refresh only missing data is fetched.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const extra = process.argv.slice(2);
const steps = ['fetch-coast', 'fetch-places', 'fetch-roads', 'fetch-speeds', 'fetch-local-roads'];
for (const step of steps) {
  console.log(`\n=== ${step} ===`);
  const r = spawnSync(process.execPath, [path.join(here, step + '.mjs'), ...extra], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\n${step} failed (exit ${r.status}), stopping.`); process.exit(r.status || 1); }
}
console.log('\nAll data files rebuilt in src/data.');

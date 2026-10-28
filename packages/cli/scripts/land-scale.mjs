/**
 * What landing sixteen shard records costs at a repository's scale, through
 * the command that ships: `variance journeys <shards…> --into <record>`, first
 * over no record, the landing a fresh CI checkout makes, then over the record
 * that landing left, the landing every later run makes.
 *
 *   node ../sense/scripts/snapshot-scale.mjs shards <dir>   # the shards, once
 *   node scripts/land-scale.mjs land <dir>                  # both landings; exits 1 above the ceiling
 *
 * The shards and the ceiling are the snapshot fixture's, in the sense package,
 * where `combine` gates the fold alone. This gates the fold and the landing
 * together, because the landing reads what the fold wrote. Each landing runs
 * in a process of its own, so its peak is its own and not the one before it.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The fixture reads its own arguments, the mode and the directory; the
// landings' shared home goes by the environment.
const [, , mode, dir] = process.argv;
const HOME = 'VARIANCE_LAND_SCALE_HOME';

if (mode === 'land') {
  const held = mkdtempSync(join(tmpdir(), 'variance-land-scale-'));
  let failed = false;
  try {
    for (const over of ['nothing', 'record']) {
      console.log(`\nover ${over === 'nothing' ? 'no record' : 'the record the landing before it left'}:`);
      const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'once', dir], {
        stdio: 'inherit',
        env: { ...process.env, [HOME]: held },
      });
      if (child.status !== 0) failed = true;
    }
  } finally {
    rmSync(held, { recursive: true, force: true });
  }
  if (failed) process.exitCode = 1;
} else if (mode === 'once') {
  const home = process.env[HOME];
  const { landJourneys } = await import('../dist/commands/land.js');
  const { FILE, count, gate, mb, secs } = await import('../../sense/scripts/snapshot-scale-fixture.mjs');
  const shards = readdirSync(FILE)
    .filter((name) => /^shard-\d+\.bin$/.test(name))
    .sort()
    .map((name) => `${FILE}/${name}`);
  // The landing keeps what it learns in the cache; this one keeps it in `home`.
  process.env.VARIANCE_AUTHORITY_CACHE = join(home, 'cache');
  const into = join(home, 'landed.bin');
  const started = Date.now();
  const landed = await landJourneys(home, shards, into);
  console.log(
    `land: ${landed.shards} shards into ${count(landed.observations)} tests, ${count(landed.modules)} modules ` +
      `in ${secs(Date.now() - started)}, ${mb(statSync(into).size)} on disk`,
  );
  gate();
} else {
  console.error('usage: node scripts/land-scale.mjs land <dir>');
  process.exitCode = 2;
}

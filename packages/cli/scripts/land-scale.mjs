/**
 * What landing sixteen shard records costs at a repository's scale, through
 * the command that ships: `variance journeys <shards…> --into <record>`, over
 * no record, which is the landing a fresh CI checkout makes.
 *
 *   node ../sense/scripts/snapshot-scale.mjs shards <dir>   # the shards, once
 *   node scripts/land-scale.mjs land <dir>                  # the landing; exits 1 above the ceiling
 *
 * The shards and the ceiling are the snapshot fixture's, in the sense package,
 * where `combine` gates the fold alone. This gates the fold and the landing
 * together, in one process, because the landing reads what the fold wrote.
 */

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { landJourneys } from '../dist/commands/land.js';
import { FILE, count, gate, mb, secs } from '../../sense/scripts/snapshot-scale-fixture.mjs';

const shards = readdirSync(FILE)
  .filter((name) => /^shard-\d+\.bin$/.test(name))
  .sort()
  .map((name) => `${FILE}/${name}`);
const home = mkdtempSync(join(tmpdir(), 'variance-land-scale-'));
// The landing keeps what it learns in the cache; this one keeps it in `home`.
process.env.VARIANCE_AUTHORITY_CACHE = join(home, 'cache');
const into = join(home, 'landed.bin');
try {
  const started = Date.now();
  const landed = await landJourneys(home, shards, into);
  console.log(
    `land: ${landed.shards} shards into ${count(landed.observations)} tests, ${count(landed.modules)} modules ` +
      `in ${secs(Date.now() - started)}, ${mb(statSync(into).size)} on disk`,
  );
} finally {
  rmSync(home, { recursive: true, force: true });
}
gate();

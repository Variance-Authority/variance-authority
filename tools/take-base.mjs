/**
 * Take the mainline's records another CI job read, as if this job had read
 * them: `node tools/take-base.mjs <handed>`, where `<handed>` is the read root
 * `check.yml`'s `base` job uploaded, one directory per suite.
 *
 * Each suite's directory is copied under this checkout's read root, and its
 * pointer is stamped as fetched now, so `suiteBase` reuses it for
 * `MAINLINE_REUSE_MS` instead of asking the line again. The line is a moving
 * ref: a job that asked it again could read a record another job of the same
 * run did not, and shards that read different records place a slice
 * differently. A suite the handed root holds no pointer for is left alone, and
 * the job asks the line itself.
 */

import { cp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  cacheRootFor,
  mainlineReadRoot,
  readFetchedMainline,
  writeFetchedMainline,
} from '@variance-authority/sense/test-selection';

const handed = process.argv[2];
if (handed === undefined) {
  console.error('take-base: name the directory the base job handed on');
  process.exit(2);
}

const cacheRoot = cacheRootFor(process.cwd());
let entries;
try {
  entries = await readdir(handed, { withFileTypes: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  entries = [];
}
for (const suite of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()) {
  const pointer = readFetchedMainline(join(handed, suite));
  if (pointer === undefined) continue;
  await cp(join(handed, suite), mainlineReadRoot(cacheRoot, suite), { recursive: true });
  await writeFetchedMainline(cacheRoot, suite, { ...pointer, fetched: new Date().toISOString() });
  console.error(`take-base: ${suite} stands on the record ${pointer.mainline} published at ${pointer.commit}, as the base job read it.`);
}
if (entries.length === 0) console.error('take-base: the base job handed nothing on, so each suite asks the line itself.');

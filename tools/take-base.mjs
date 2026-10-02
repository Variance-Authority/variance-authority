/**
 * Take the mainline's records another CI job read, as if this job had read
 * them: `node tools/take-base.mjs <handed> <uploaded>`, where `<handed>` is the
 * read root `check.yml`'s `base` job uploaded, one directory per suite, and
 * `<uploaded>` is `true` when that job's upload made an artifact.
 *
 * Each suite's directory is copied under this checkout's read root, and what
 * it holds is stamped as read now: the pointer to the record fetched, or the
 * line's answer that it gave none. `suiteBase` then answers with it for
 * `MAINLINE_REUSE_MS` instead of asking the line again. The line is a moving
 * ref: a job that asked it again could read a record another job of the same
 * run did not, and shards that read different records place a slice
 * differently. A suite the handed root holds neither for is one the line was
 * never asked about, and is left alone.
 *
 * An artifact that was uploaded and is not here is an error, not a run with
 * nothing handed: the job stops rather than ask the line on its own.
 */

import { cp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readMissedMainline, writeMissedMainline } from '@variance-authority/cli';
import {
  cacheRootFor,
  mainlineReadRoot,
  readFetchedMainline,
  writeFetchedMainline,
} from '@variance-authority/sense/test-selection';

const [handed, uploaded] = process.argv.slice(2);
if (handed === undefined || (uploaded !== 'true' && uploaded !== 'false')) {
  console.error('take-base: name the directory the base job handed on, and whether it uploaded one (true or false)');
  process.exit(2);
}

let entries;
try {
  entries = (await readdir(handed, { withFileTypes: true })).filter((entry) => entry.isDirectory());
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  entries = [];
}
if (entries.length === 0) {
  if (uploaded === 'true') {
    console.error(`take-base: the base job uploaded its read, and ${handed} holds none of it; stopping rather than ask the line on its own.`);
    process.exit(1);
  }
  // `base` asked no line: no suite is given to the share, or this environment
  // names no mainline or lacks the share's credential. A job that asks finds
  // the same, so there is nothing to hand.
  console.error('take-base: the base job asked no line, so there is no answer to take.');
  process.exit(0);
}

const cacheRoot = cacheRootFor(process.cwd());
const now = new Date().toISOString();
for (const suite of entries.map((entry) => entry.name).sort()) {
  const from = join(handed, suite);
  const pointer = readFetchedMainline(from);
  const missed = readMissedMainline(from);
  if (pointer === undefined && missed === undefined) continue;
  const readRoot = mainlineReadRoot(cacheRoot, suite);
  await cp(from, readRoot, { recursive: true });
  if (pointer !== undefined) {
    await writeFetchedMainline(cacheRoot, suite, { ...pointer, fetched: now });
    console.error(`take-base: ${suite} stands on the record ${pointer.mainline} published at ${pointer.commit}, as the base job read it.`);
  }
  if (missed !== undefined) {
    await writeMissedMainline(readRoot, { ...missed, at: now });
    console.error(`take-base: ${suite} stands on mainline ${missed.mainline}'s answer of ${missed.miss.kind}, as the base job read it.`);
  }
}

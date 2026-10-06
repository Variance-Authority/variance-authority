/**
 * Take the records a pull request's last push left as this checkout's own:
 * `node tools/take-carried.mjs <carried> <checked>`, where `<carried>` holds
 * one directory per suite, as the `record` job of `check.yml` folded them, and
 * `<checked>` is `true` when `check.yml`'s `base` job already took them and
 * kept only the suites it could. The taken suites are printed, space-separated.
 *
 * A checkout that holds its own layer reads from it, and a selection diffs
 * each test from the commit it last ran at. That is what a laptop does between
 * two runs of `yarn test:since`, and carried here it is what CI does between
 * two pushes: the second push runs what changed since the first ran, and every
 * file the first left incomplete, a failed one included.
 *
 * The commits a carried record names are the merge commits of earlier pushes.
 * GitHub moves `refs/pull/<n>/merge` on every push, so no ref a clone fetches
 * holds them, and each is fetched by name. A suite whose commits cannot all be
 * had is left, and says which: its tests would be diffed from nothing. A suite
 * left reads the mainline's record, as a push with nothing carried does.
 *
 * Nothing is laid over a record the checkout already holds.
 *
 * A suite `base` took and this job cannot is an error, not a suite read from
 * the mainline: two shards of one slice that read two records place it
 * differently, and `record` refuses to fold them.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCommitRuns, testCoverageFile } from '@variance-authority/sense/test-selection';

/**
 * The commits a selection reads from the record at `coverage`: where it was
 * recorded, where its runs started, and where each test stands. Undefined when
 * no runs record beside it names where it was recorded.
 */
async function namedCommits(coverage) {
  const runs = await readCommitRuns(coverage);
  if (runs?.commit === undefined) return undefined;
  return [...new Set([runs.commit, runs.over, ...(runs.standing ?? []).map((entry) => entry.commit)])].filter(
    (commit) => commit !== undefined,
  );
}

const holds = (root, commit) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${commit}^{commit}`], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Lay each suite under `carried` into the checkout at `root`. `taken` names
 * the suites laid; `left` the rest, each with the commits the remote did not
 * give, the record the checkout already held, or `unlisted` when the record
 * names no commit its tests ran at: a selection would have nothing to diff
 * each test from.
 */
export async function takeCarried(root, carried) {
  let entries;
  try {
    entries = (await readdir(carried, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    entries = [];
  }
  const taken = [];
  const left = [];
  for (const suite of entries.map((entry) => entry.name).sort()) {
    const from = join(carried, suite);
    if (!existsSync(join(from, 'coverage.bin'))) continue;
    const own = testCoverageFile(root, { suite });
    if (existsSync(own)) {
      left.push({ suite, held: own });
      continue;
    }
    const named = await namedCommits(join(from, 'coverage.bin'));
    if (named === undefined) {
      left.push({ suite, unlisted: true });
      continue;
    }
    const absent = named.filter((commit) => !holds(root, commit));
    if (absent.length > 0) {
      try {
        execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', ...absent], { cwd: root, stdio: 'ignore' });
      } catch {
        // One commit the remote no longer has fails the whole fetch; each is asked after.
        for (const commit of absent) {
          try {
            execFileSync('git', ['fetch', '--quiet', '--no-tags', 'origin', commit], { cwd: root, stdio: 'ignore' });
          } catch {}
        }
      }
    }
    const missing = absent.filter((commit) => !holds(root, commit));
    if (missing.length > 0) {
      left.push({ suite, missing });
      continue;
    }
    await cp(from, dirname(own), { recursive: true });
    taken.push(suite);
  }
  return { taken, left };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [carried, checked] = process.argv.slice(2);
  if (carried === undefined || (checked !== 'true' && checked !== 'false')) {
    console.error('take-carried: name the directory the last push carried, one directory per suite, and whether the base job checked it (true or false)');
    process.exit(2);
  }
  const { taken, left } = await takeCarried(process.cwd(), carried);
  for (const suite of taken) console.error(`take-carried: ${suite} reads from what the last push ran.`);
  for (const { suite, missing, held } of left) {
    console.error(
      held !== undefined
        ? `take-carried: ${suite} keeps the record already at ${held}.`
        : missing !== undefined
          ? `take-carried: ${suite} reads the mainline's record: the remote no longer has ${missing.map((commit) => commit.slice(0, 12)).join(', ')}, which the last push's record stands on.`
          : `take-carried: ${suite} reads the mainline's record: the last push's record has no runs record naming the commit it was recorded at.`,
    );
  }
  if (taken.length === 0 && left.length === 0) console.error('take-carried: no earlier push carried a record, so every suite reads the mainline\'s.');
  if (checked === 'true' && left.length > 0) {
    console.error('take-carried: the base job took every suite handed here; stopping rather than read another record than the other jobs read.');
    process.exit(1);
  }
  process.stdout.write(taken.join(' '));
}

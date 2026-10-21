/**
 * Bundle the commits a pull request's records stand on that no remote holds:
 * `node tools/bundle-carried.mjs <carried> <mainline>`, where `<carried>` holds
 * one directory per suite, as `check.yml`'s `record` job keeps them for the
 * next push, and `<mainline>` is the ref every later clone holds, which the
 * bundle leaves out. The bundled commits are printed, space-separated.
 *
 * `check.yml` merges a pull request's head with the commit the mainline's
 * record was made at, so the commit its tests ran at is a merge it made itself
 * and never pushed. The next push takes the records, and its selection diffs
 * each test from that commit: `tools/take-carried.mjs` fetches it from
 * `<carried>/commits.bundle` before it asks the remote. A bundle needs refs, so
 * each commit is named `refs/carried/<n>` while it is written, and the refs are
 * gone after.
 *
 * A record whose every commit is on the mainline bundles nothing and writes no
 * file. A commit this clone does not hold cannot be bundled: it is left out
 * and named, and the next push reads that suite from the mainline.
 */

import { execFileSync } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { namedCommits } from './take-carried.mjs';

/** Where `takeCarried` looks for the commits beside the records. */
export const BUNDLE = 'commits.bundle';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const succeeds = (root, ...args) => {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/**
 * Write `<carried>/commits.bundle` holding every commit the records under
 * `carried` name that `mainline` does not hold, with what they need beyond it.
 * `bundled` names those commits, and `absent` the ones this clone lacks.
 */
export async function bundleCarried(root, carried, mainline) {
  const suites = (await readdir(carried, { withFileTypes: true })).filter((entry) => entry.isDirectory());
  const named = new Set();
  for (const suite of suites) {
    for (const commit of (await namedCommits(join(carried, suite.name, 'coverage.bin'))) ?? []) named.add(commit);
  }
  const held = [...named].filter((commit) => succeeds(root, 'cat-file', '-e', `${commit}^{commit}`));
  const absent = [...named].filter((commit) => !held.includes(commit)).sort();
  const bundled = held.filter((commit) => !succeeds(root, 'merge-base', '--is-ancestor', commit, mainline)).sort();
  await rm(join(carried, BUNDLE), { force: true });
  if (bundled.length === 0) return { bundled, absent };
  const refs = bundled.map((commit, index) => [`refs/carried/${String(index)}`, commit]);
  try {
    for (const [ref, commit] of refs) git(root, 'update-ref', ref, commit);
    git(root, 'bundle', 'create', '--quiet', join(carried, BUNDLE), ...refs.map(([ref]) => ref), '--not', mainline);
  } finally {
    for (const [ref] of refs) git(root, 'update-ref', '-d', ref);
  }
  return { bundled, absent };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [carried, mainline] = process.argv.slice(2);
  if (carried === undefined || mainline === undefined) {
    console.error('bundle-carried: name the directory of records the next push takes, and the mainline ref every clone holds');
    process.exit(2);
  }
  const { bundled, absent } = await bundleCarried(process.cwd(), carried, mainline);
  if (absent.length > 0) {
    console.error(
      `bundle-carried: this clone does not hold ${absent.map((commit) => commit.slice(0, 12)).join(', ')}, which the records name, so the next push reads their suites from the mainline.`,
    );
  }
  console.error(
    bundled.length === 0
      ? `bundle-carried: every commit the records name is on ${mainline}, so nothing is bundled.`
      : `bundle-carried: ${String(bundled.length)} commit(s) no remote holds are bundled in ${join(carried, BUNDLE)}.`,
  );
  process.stdout.write(bundled.join(' '));
}

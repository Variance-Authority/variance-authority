/**
 * Bundle the merges `check.yml` made that no remote holds:
 * `node tools/bundle-carried.mjs bundle <carried> <mainline>` writes
 * `<carried>/commits.bundle`, and `fetch <carried>` fetches it into the clone.
 * This workflow merges a pull request with the commit the mainline's record was
 * made at, so every job of the next push fetches those merges before `variance
 * carry take` fetches the rest by name; a user's workflow runs on GitHub's
 * merge, which needs none.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { namedCommits } from '@variance-authority/sense/test-selection';

/** Where `check.yml` looks for the commits beside the records. */
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
 * `bundled` names those commits, and `absent` the ones this clone lacks; the
 * next push reads an absent commit's suite from the mainline. A bundle needs
 * refs, so each commit is named `refs/carried/<n>` while it is written.
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

/**
 * Fetch the commits `<carried>/commits.bundle` holds into the clone at `root`,
 * and name them. Nothing where no bundle was kept; a bundle that does not read
 * throws, and the job says which suites that leaves.
 */
export function fetchBundled(root, carried) {
  const bundle = join(carried, BUNDLE);
  if (!existsSync(bundle)) return [];
  const heads = git(root, 'bundle', 'list-heads', bundle).split('\n').filter(Boolean).map((line) => line.split(' '));
  git(root, 'fetch', '--quiet', '--no-tags', bundle, ...heads.map(([, ref]) => ref));
  return heads.map(([commit]) => commit).sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [mode, carried, mainline] = process.argv.slice(2);
  if (mode === 'fetch' && carried !== undefined) {
    try {
      const fetched = fetchBundled(process.cwd(), carried);
      if (fetched.length > 0) console.error(`bundle-carried: fetched ${String(fetched.length)} commit(s) from ${join(carried, BUNDLE)}.`);
    } catch (error) {
      console.error(`bundle-carried: ${join(carried, BUNDLE)} did not read, so its suites read main's record unless the remote has their commits: ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(0);
  }
  if (mode !== 'bundle' || carried === undefined || mainline === undefined) {
    console.error('bundle-carried: `bundle <carried> <mainline>` names the directory of records the next push takes and the mainline ref every clone holds; `fetch <carried>` names the directory a push took them into');
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

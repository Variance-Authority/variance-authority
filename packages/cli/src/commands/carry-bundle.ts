/**
 * The commits kept records name that no remote holds, kept beside them.
 *
 * A workflow that merges a pull request's head itself, as `carry merge` does,
 * runs on a merge no remote holds, and the record it keeps names that merge.
 * A later clone cannot fetch it by name, so `keep` writes it to a git bundle
 * beside the records, with every commit it needs that the mainline does not
 * hold, and `take` reads the bundle before it asks the remote for the rest.
 */

// compass: variance-authority.retention

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { namedCommits } from '@variance-authority/sense/test-selection';

/** The file beside the records that holds the commits no remote holds. */
export const BUNDLE = 'commits.bundle';

export interface KeptCommits {
  /** The commits written to the bundle. */
  readonly bundled: readonly string[];
  /** Why nothing was bundled, when a mainline to bundle against could not be had. */
  readonly unbundled?: string;
}

/** What git said, trimmed; throws when it fails. */
export const git = (root: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Whether git succeeded. */
export const succeeds = (root: string, ...args: string[]): boolean => {
  try {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** Whether the clone at `root` holds `commit`. */
export const holds = (root: string, commit: string): boolean => succeeds(root, 'cat-file', '-e', `${commit}^{commit}`);

/**
 * Write `<dir>/commits.bundle` holding every commit the records under `dir`
 * name that `mainline` does not hold, with what they need beyond it. With no
 * `mainline`, or one this clone lacks, nothing is bundled: every clone holds the
 * mainline, and without it the bundle would carry the whole history. A bundle
 * needs refs, so each commit is named `refs/carried/<n>` while it is written.
 */
export async function keepCommits(root: string, dir: string, mainline: string | undefined): Promise<KeptCommits> {
  const named = new Set<string>();
  for (const suite of (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory())) {
    for (const commit of (await namedCommits(join(dir, suite.name, 'coverage.bin'))) ?? []) named.add(commit);
  }
  // A commit this clone lacks cannot be kept: `take` leaves the suites standing on it.
  const held = [...named].filter((commit) => holds(root, commit));
  await rm(join(dir, BUNDLE), { force: true });
  if (held.length === 0) return { bundled: [] };
  if (mainline === undefined) return { bundled: [], unbundled: 'no mainline is named, so nothing marks which commits every clone holds' };
  if (!succeeds(root, 'rev-parse', '--verify', '--quiet', `${mainline}^{commit}`)) {
    return { bundled: [], unbundled: `this clone has no ${mainline}, the mainline every clone holds` };
  }
  const bundled = held.filter((commit) => !succeeds(root, 'merge-base', '--is-ancestor', commit, mainline)).sort();
  if (bundled.length === 0) return { bundled };
  const refs = bundled.map((commit, index) => [`refs/carried/${String(index)}`, commit] as const);
  try {
    for (const [ref, commit] of refs) git(root, 'update-ref', ref, commit);
    git(root, 'bundle', 'create', '--quiet', join(dir, BUNDLE), ...refs.map(([ref]) => ref), '--not', mainline);
  } finally {
    for (const [ref] of refs) git(root, 'update-ref', '-d', ref);
  }
  return { bundled };
}

/**
 * Fetch the commits `<dir>/commits.bundle` holds into the clone at `root`, each
 * head by name into `FETCH_HEAD` alone: the commits are wanted, not the refs
 * that named them. Absent when it read, or none was kept; otherwise why not, in
 * git's words, and the suites standing on those commits are left.
 */
export function takeCommits(root: string, dir: string): string | undefined {
  const bundle = join(dir, BUNDLE);
  if (!existsSync(bundle)) return undefined;
  try {
    const heads = git(root, 'bundle', 'list-heads', bundle)
      .split('\n')
      .map((line) => line.split(' ')[1])
      .filter((ref): ref is string => ref !== undefined);
    git(root, 'fetch', '--quiet', '--no-tags', bundle, ...heads);
    return undefined;
  } catch (error) {
    const said = (error as { stderr?: unknown }).stderr;
    return `${bundle} did not read: ${String(said ?? error).trim()}`;
  }
}

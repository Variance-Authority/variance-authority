/**
 * What the CLI's own cache directories may lose, asked of git and the clock.
 *
 * Three directories hold one entry per commit — the suite index a run wrote at
 * `suite/<project>/<commit>.bin`, the record a share handed over at
 * `share/read/<suite>/<commit>/`, and a shared report at `report/<digest>/` —
 * and nothing took any of them back. A checkout that runs a few times a day
 * gains an entry a run, and a question is only ever asked of the newest few.
 *
 * A commit entry is removed when git says it is out of reach: more than
 * {@link COMMITS_BEHIND} commits behind `HEAD`, or not contained in `HEAD` and
 * older than {@link STORY_AGE_MS} — the branch it was written on was dropped or
 * rebased. A commit this clone does not hold is kept until it is older than
 * {@link UNMARKED_AGE_MS}, because git cannot answer for it and another project
 * may share the cache. The newest entry of each project and each suite, and the
 * mainline record a suite's `fetched.json` names, always
 * stays. A shared report names no commit, so it is aged out after
 * {@link STORY_AGE_MS}; the share still holds it, and the next read fetches it.
 *
 * `scans/` has no writer: the source index replaced it, and it is removed whole.
 */

// compass: variance-authority.retention

import { existsSync } from 'node:fs';
import { readdir, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  applyPrune,
  bytesUnder,
  machineOwners,
  planPrune,
  prunedLine,
  readFetchedMainline,
  pruneWhenDue,
  PRUNE_EVERY_MS,
  STORY_AGE_MS,
  UNMARKED_AGE_MS,
  type KeptEntry,
  type PruneEntry,
  type PrunePlan,
  type Pruned,
} from '@variance-authority/sense/test-selection';
import type { Config } from '../config.js';
import { EXIT_CLEAN, EXIT_OPERATOR, type ExitCode } from '../exit.js';
import { headPast } from '../share-lines.js';
import { cacheOf, sharedReportRoot, shareRoot, suiteIndexRoot } from './resources.js';

/** How far behind `HEAD` a commit's entry may fall before a question about it stops being likely. */
export const COMMITS_BEHIND = 200;

/** Why a CLI cache entry is removed. {@link CACHE_PRUNE_REASONS} says it in words. */
export type CachePruneReason = 'behind' | 'off-line' | 'unheld' | 'old-report' | 'unwritten';

/** Each reason, as one entry and as several. */
export const CACHE_PRUNE_REASONS: Readonly<Record<CachePruneReason, readonly [string, string]>> = {
  behind: [`commit more than ${COMMITS_BEHIND} behind HEAD`, `commits more than ${COMMITS_BEHIND} behind HEAD`],
  'off-line': ['commit HEAD does not contain, older than 14 days', 'commits HEAD does not contain, older than 14 days'],
  unheld: ['commit this clone does not hold, older than 30 days', 'commits this clone does not hold, older than 30 days'],
  'old-report': ['shared report older than 14 days', 'shared reports older than 14 days'],
  unwritten: ['directory nothing writes any more', 'directories nothing writes any more'],
};

/** The parties a plan asks. Injected so a test can answer for them. */
export interface CacheOwners {
  readonly now: number;
  /** How many commits `HEAD` is past `commit`: `false` when it does not contain it, absent when git cannot say. */
  past(commit: string): Promise<number | false | undefined>;
}

/** The owners as they answer for real, from the checkout at `cwd`. */
export function checkoutOwners(cwd: string = process.cwd(), now: number = Date.now()): CacheOwners {
  return { now, past: (commit) => headPast(commit, cwd) };
}

/**
 * What a prune of the CLI's cache directories would remove, and what it keeps
 * because git could not answer. Reads only; `applyPrune` removes. `measure`
 * also totals the bytes the directories hold.
 */
export async function planCachePrune(
  config: Pick<Config, 'cacheRoot'>,
  owners: CacheOwners,
  options: { readonly measure?: boolean } = {},
): Promise<PrunePlan<CachePruneReason>> {
  const root = cacheOf(config);
  const remove: PruneEntry<CachePruneReason>[] = [];
  const kept: KeptEntry[] = [];
  const drop = async (path: string, reason: CachePruneReason): Promise<void> => {
    remove.push({ path, bytes: await bytesUnder(path), reason });
  };
  // One question per commit, however many directories hold it.
  const asked = new Map<string, Promise<number | false | undefined>>();
  const past = (commit: string) => asked.get(commit) ?? asked.set(commit, owners.past(commit)).get(commit)!;

  const commits = async (entries: readonly CommitEntry[]): Promise<void> => {
    const newest = entries.reduce<CommitEntry | undefined>((best, entry) => (best === undefined || entry.written > best.written ? entry : best), undefined);
    for (const entry of entries) {
      if (entry === newest) continue;
      const behind = await past(entry.commit);
      const age = owners.now - entry.written;
      if (typeof behind === 'number') {
        if (behind > COMMITS_BEHIND) await drop(entry.path, 'behind');
      } else if (behind === false) {
        if (age > STORY_AGE_MS) await drop(entry.path, 'off-line');
      } else if (age > UNMARKED_AGE_MS) {
        await drop(entry.path, 'unheld');
      } else {
        kept.push({ path: entry.path, reason: 'a commit this clone does not hold; kept until 30 days old' });
      }
    }
  };

  const suites = suiteIndexRoot(config);
  for (const project of await directoriesIn(suites)) {
    const directory = join(suites, project);
    await commits(await commitEntries(directory, (name) => /^([0-9a-f]{7,64})\.bin$/u.exec(name)?.[1]));
  }
  const read = join(shareRoot(config), 'read');
  for (const suite of await directoriesIn(read)) {
    const directory = join(read, suite);
    // The record `fetched.json` names is the base every checkout of this
    // machine lays its first run on, however far behind it falls.
    const named = readFetchedMainline(directory)?.commit;
    await commits(await commitEntries(directory, (name) => (name === named ? undefined : /^[0-9a-f]{7,64}$/u.exec(name)?.[0])));
  }

  const reports = sharedReportRoot(config);
  for (const name of await namesIn(reports)) {
    const path = join(reports, name);
    const written = await mtimeOf(path);
    if (written !== undefined && owners.now - written > STORY_AGE_MS) await drop(path, 'old-report');
  }

  const scans = join(root, 'scans');
  if (existsSync(scans)) await drop(scans, 'unwritten');

  let held: number | undefined;
  if (options.measure === true) {
    held = 0;
    for (const path of [suites, read, reports, scans]) held += await bytesUnder(path);
  }
  return { root, remove, kept, ...(held !== undefined ? { held } : {}) };
}

/**
 * Prune the CLI's cache directories, when the last prune was more than a day ago.
 *
 * Called at the end of a run, after its report is written. Never throws, for
 * the reason `pruneWhenDue` gives: a cache that could not be pruned today is
 * pruned tomorrow, and a run must not fail over it.
 */
export async function pruneCacheWhenDue(
  config: Pick<Config, 'cacheRoot'>,
  owners: CacheOwners = checkoutOwners(),
): Promise<Pruned<CachePruneReason> | undefined> {
  try {
    const root = cacheOf(config);
    if (!existsSync(root)) return undefined;
    const stamp = join(root, '.pruned');
    const last = await stat(stamp).then((found) => found.mtimeMs, () => undefined);
    if (last !== undefined && owners.now - last < PRUNE_EVERY_MS) return undefined;
    await writeFile(stamp, '');
    await utimes(stamp, owners.now / 1000, owners.now / 1000);
    return await applyPrune(await planCachePrune(config, owners));
  } catch {
    return undefined;
  }
}

interface CommitEntry {
  readonly path: string;
  readonly commit: string;
  readonly written: number;
}

async function commitEntries(directory: string, commitOf: (name: string) => string | undefined): Promise<readonly CommitEntry[]> {
  const entries: CommitEntry[] = [];
  for (const name of await namesIn(directory)) {
    const commit = commitOf(name);
    if (commit === undefined) continue;
    const path = join(directory, name);
    const written = await mtimeOf(path);
    if (written !== undefined) entries.push({ path, commit, written });
  }
  return entries;
}

async function mtimeOf(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function namesIn(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}

async function directoriesIn(directory: string): Promise<readonly string[]> {
  try {
    const found = await readdir(directory, { withFileTypes: true });
    return found.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Both halves of a prune, as applied. */
export interface BothPruned {
  readonly selection: Pruned | undefined;
  readonly commits: Pruned<CachePruneReason> | undefined;
}

/** Prune both halves of the cache now, whenever the last prune was. */
export async function pruneNow(config: Pick<Config, 'cacheRoot'>): Promise<BothPruned> {
  const root = cacheOf(config);
  return {
    selection: existsSync(join(root, 'test-selection')) ? await applyPrune(await planPrune(root, machineOwners())) : undefined,
    commits: existsSync(root) ? await applyPrune(await planCachePrune(config, checkoutOwners())) : undefined,
  };
}

/**
 * `variance prune`: both halves now, what was taken, and {@link prunedExit} for what was not.
 *
 * The cache is the repository's, from `cacheRootFor`, so it needs no project
 * config. A test runner's fold never prunes: what a cache shared beyond one run
 * loses is decided here or at the end of `variance run`, never as a side effect
 * of a test file finishing.
 */
export async function pruneOutput(config: Pick<Config, 'cacheRoot'> = {}): Promise<{ text: string; exit: ExitCode }> {
  const pruned = await pruneNow(config);
  return { text: prunedLines(pruned) || 'cache: nothing to prune\n', exit: prunedExit(pruned) };
}

/**
 * Prune both halves when due, and say what was taken: the end of `variance run`.
 *
 * Each half keeps its own stamp, so neither walks twice in a day.
 */
export async function pruneWhenDueLines(config: Pick<Config, 'cacheRoot'>): Promise<string> {
  return prunedLines({ selection: await pruneWhenDue(cacheOf(config)), commits: await pruneCacheWhenDue(config) });
}

/** One line per half that took something, and one per entry it could not remove, each ending in a newline; empty when neither half did either. */
export function prunedLines(pruned: BothPruned): string {
  return [prunedLine(pruned.selection), prunedLine(pruned.commits, CACHE_PRUNE_REASONS)]
    .filter((line) => line !== '')
    .map((line) => `${line}\n`)
    .join('');
}

/** {@link EXIT_OPERATOR} when either half could not remove an entry its plan named: the machine, not a finding, is wrong. */
export function prunedExit(pruned: BothPruned): ExitCode {
  const unremoved = (pruned.selection?.unremoved.length ?? 0) + (pruned.commits?.unremoved.length ?? 0);
  return unremoved > 0 ? EXIT_OPERATOR : EXIT_CLEAN;
}

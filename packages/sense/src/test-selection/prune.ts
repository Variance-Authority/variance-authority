/**
 * What the test-selection cache may lose, asked of whoever knows.
 *
 * Everything under `test-selection` is keyed by a digest of a checkout's path,
 * and until the checkouts started naming themselves nothing could say which of
 * those directories still had a checkout behind them. So nothing was ever
 * removed: a worktree deleted this morning, a checkout moved last month and a
 * temporary directory a test made and dropped all left a directory behind, and
 * a machine that runs a few suites a day held thousands of them within a week.
 *
 * Each rule below removes something only on the word of the party that owns
 * the answer:
 *
 * - **A checkout that no longer exists.** Its layer's {@link CHECKOUT_MARKER}
 *   names the path, and the file system says whether it is still there.
 * - **A worktree git no longer lists.** For a layer written before markers
 *   existed, `git worktree list` in the primary checkout names every worktree
 *   the repository still has.
 * - **A run whose process is gone.** A run's scratch directory is named for its
 *   process, and the process table says whether it is alive and when it
 *   started: a process that started after the directory was last written is a
 *   reused id, not the writer. An hour's floor covers a cache restored on
 *   another machine.
 * - **A story older than two weeks.** A story is written for somebody reading
 *   one case, now; nothing selects on it and nothing compares it.
 *
 * When the owner cannot answer, the entry stays until nothing in it has been
 * written for {@link UNMARKED_AGE_MS}, and the plan says it was kept and why.
 *
 * The recording itself — `coverage.bin`, its runs and its cases — is never aged
 * out while its checkout exists. It is one file rewritten by every run, so it
 * does not grow with history, and removing it turns the next `test:since` into
 * the whole suite without saying so.
 */

// compass: variance-authority.retention

import { execFile } from 'node:child_process';
import { realpathSync, existsSync } from 'node:fs';
import { lstat, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkoutKey, readCheckoutMarker } from './cache-layers.js';

/** How long a dead run's scratch waits, in case its process id was reused. */
export const RUN_FLOOR_MS = 60 * 60 * 1000;

/** Two weeks, as the render cache keeps an image nobody asked for. */
export const STORY_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** How long a layer nobody can place is kept after it was last written. */
export const UNMARKED_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** How often a run prunes: once a day is enough for a cache that fills over weeks. */
export const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;

/** Why an entry is removed. {@link PRUNE_REASONS} says it in words. */
export type PruneReason = 'gone' | 'unlisted' | 'dead-run' | 'old-story' | 'unplaced';

/** Each reason, as one entry and as several. */
export const PRUNE_REASONS: Readonly<Record<PruneReason, readonly [string, string]>> = {
  gone: ['checkout that no longer exists', 'checkouts that no longer exist'],
  unlisted: ['worktree git no longer lists', 'worktrees git no longer lists'],
  'dead-run': ['run whose process is gone', 'runs whose processes are gone'],
  'old-story': ['story older than 14 days', 'stories older than 14 days'],
  unplaced: ['layer naming no checkout, unwritten for 30 days', 'layers naming no checkout, unwritten for 30 days'],
};

/** One entry a prune removes: where, how large, and which rule removed it. */
export interface PruneEntry<Reason extends string = PruneReason> {
  readonly path: string;
  readonly bytes: number;
  readonly reason: Reason;
}

/** An entry an owner could not answer for, which is kept until it is old. */
export interface KeptEntry {
  readonly path: string;
  readonly reason: string;
}

/**
 * What a prune would do, before it does it: {@link planPrune} writes one and
 * {@link applyPrune} carries it out, so doctor's reading and a run's prune are
 * one plan.
 */
export interface PrunePlan<Reason extends string = PruneReason> {
  /** The directory that was walked: `<cache>/test-selection`. */
  readonly root: string;
  readonly remove: readonly PruneEntry<Reason>[];
  readonly kept: readonly KeptEntry[];
  /** Bytes under the root before pruning. Absent unless measuring was asked for. */
  readonly held?: number;
}

/** The parties a plan asks. Injected so a test can answer for them. */
export interface PruneOwners {
  readonly now: number;
  /** Whether the process is running and started before `written`, so it could be the writer. */
  alive(pid: number, written: number): Promise<boolean>;
  /** Whether a checkout is still on disk. */
  exists(path: string): boolean;
  /** The worktrees git lists for a primary checkout, or undefined when git cannot say. */
  worktrees(primary: string): Promise<readonly string[] | undefined>;
}

/** The owners as they answer for real. */
export function machineOwners(now: number = Date.now()): PruneOwners {
  return {
    now,
    alive: async (pid, written) => {
      try {
        process.kill(pid, 0);
      } catch (error) {
        // EPERM: the process is alive and belongs to somebody else.
        if ((error as NodeJS.ErrnoException).code !== 'EPERM') return false;
      }
      const started = await startedAt(pid);
      return started === undefined || started <= written;
    },
    exists: (path) => existsSync(path),
    worktrees: (primary) => listWorktrees(primary),
  };
}

/**
 * What a prune of `cacheRoot` would remove, and what it keeps for want of an answer.
 *
 * Reads only; {@link applyPrune} removes. `measure` also totals the bytes the
 * cache holds, which walks every file, so doctor asks for it and a run does not.
 */
export async function planPrune(
  cacheRoot: string,
  owners: PruneOwners = machineOwners(),
  options: { readonly measure?: boolean } = {},
): Promise<PrunePlan> {
  const root = join(cacheRoot, 'test-selection');
  const remove: PruneEntry[] = [];
  const kept: KeptEntry[] = [];
  const drop = async (path: string, reason: PruneReason): Promise<void> => {
    remove.push({ path, bytes: await bytesUnder(path), reason });
  };

  for (const name of await directoriesIn(root)) {
    const repository = join(root, name);
    const marker = readCheckoutMarker(repository);
    if (marker !== undefined && !owners.exists(marker.checkout)) {
      await drop(repository, 'gone');
      continue;
    }
    if (marker === undefined) {
      if (!(await writtenSince(repository, owners.now - UNMARKED_AGE_MS))) {
        await drop(repository, 'unplaced');
        continue;
      }
      kept.push({ path: repository, reason: 'names no checkout; kept until unwritten for 30 days' });
    }
    await layer(repository, owners, drop);

    const work = join(repository, '.work');
    const layers = await directoriesIn(work);
    if (layers.length === 0) continue;
    const primary = marker?.checkout ?? layers.map((key) => readCheckoutMarker(join(work, key))?.primary).find(Boolean);
    const listed = primary === undefined ? undefined : await listedKeys(primary, owners);
    for (const key of layers) {
      const path = join(work, key);
      const own = readCheckoutMarker(path);
      if (own !== undefined) {
        if (owners.exists(own.checkout)) await layer(path, owners, drop);
        else await drop(path, 'gone');
        continue;
      }
      // Written before markers: git is asked, and a day's floor covers a
      // worktree whose path git spells differently from the process that keyed it.
      const recent = await writtenSince(path, owners.now - PRUNE_EVERY_MS);
      if (listed !== undefined && !listed.has(key) && !recent) {
        await drop(path, 'unlisted');
      } else if (listed === undefined && !(await writtenSince(path, owners.now - UNMARKED_AGE_MS))) {
        await drop(path, 'unplaced');
      } else {
        if (listed === undefined) {
          const why = primary === undefined
            ? 'names no checkout, and neither does the repository it sits in'
            : 'names no checkout, and git could not list the worktrees';
          kept.push({ path, reason: `${why}; kept until unwritten for 30 days` });
        }
        await layer(path, owners, drop);
      }
    }
  }

  return {
    root,
    remove,
    kept,
    ...(options.measure === true ? { held: await bytesUnder(root) } : {}),
  };
}

/** An entry a prune was asked to remove and could not, with the error that stopped it. */
export interface UnremovedEntry<Reason extends string = PruneReason> extends PruneEntry<Reason> {
  readonly error: string;
}

/** What a prune took, once it was applied, and what it was asked to take and could not. */
export interface Pruned<Reason extends string = PruneReason> {
  readonly root: string;
  readonly removed: readonly PruneEntry<Reason>[];
  readonly unremoved: readonly UnremovedEntry<Reason>[];
  readonly freed: number;
}

/**
 * Remove exactly what the plan names. Never throws: an entry that could not be
 * removed is returned in `unremoved` with its error, and not counted as freed.
 */
export async function applyPrune<Reason extends string>(plan: PrunePlan<Reason>): Promise<Pruned<Reason>> {
  const removed: PruneEntry<Reason>[] = [];
  const unremoved: UnremovedEntry<Reason>[] = [];
  for (const entry of plan.remove) {
    try {
      await rm(entry.path, { recursive: true, force: true });
      removed.push(entry);
    } catch (error) {
      unremoved.push({ ...entry, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { root: plan.root, removed, unremoved, freed: removed.reduce((total, entry) => total + entry.bytes, 0) };
}

/**
 * Prune, when the last prune of this cache was more than a day ago.
 *
 * Called by `variance run` as it ends, after every suite it started has folded
 * its record. A test runner's own fold never calls it: the run removes only its
 * own scratch, and a cache shared beyond it is pruned by a command. The stamp is
 * claimed before the walk, so two runs ending together do not both walk. Never
 * throws: a cache that could not be pruned is a cache that is pruned tomorrow,
 * and a run must not fail over it.
 */
export async function pruneWhenDue(
  cacheRoot: string,
  owners: PruneOwners = machineOwners(),
): Promise<Pruned | undefined> {
  try {
    const stamp = join(cacheRoot, 'test-selection', '.pruned');
    const last = await stat(stamp).then((found) => found.mtimeMs, () => undefined);
    if (last !== undefined && owners.now - last < PRUNE_EVERY_MS) return undefined;
    // An absent `test-selection` is a cache with nothing in it: there is nothing to prune and nowhere to stamp.
    if (!existsSync(join(cacheRoot, 'test-selection'))) return undefined;
    await writeFile(stamp, '');
    await utimes(stamp, owners.now / 1000, owners.now / 1000);
    return await applyPrune(await planPrune(cacheRoot, owners));
  } catch {
    return undefined;
  }
}

/**
 * One line saying what a prune took, then one line for each entry it could not
 * remove, naming the path and the error; empty when it took nothing and
 * nothing failed.
 */
export function prunedLine<Reason extends string = PruneReason>(
  pruned: Pruned<Reason> | undefined,
  reasons: Readonly<Record<Reason, readonly [string, string]>> = PRUNE_REASONS as Readonly<Record<string, readonly [string, string]>>,
): string {
  if (pruned === undefined) return '';
  const lines = pruned.unremoved.map((entry) => `cache: could not remove ${entry.path}, a ${reasons[entry.reason][0]}: ${entry.error}`);
  if (pruned.removed.length > 0) lines.unshift(`cache: freed ${mib(pruned.freed)} in ${pruned.root}: ${counted(pruned.removed, reasons)}`);
  return lines.join('\n');
}

/** `3 runs whose processes are gone, 1 story older than 14 days`, in the order the reasons first appear. */
export function counted<Reason extends string>(
  entries: readonly { readonly reason: Reason }[],
  reasons: Readonly<Record<Reason, readonly [string, string]>>,
): string {
  const counts = new Map<Reason, number>();
  for (const entry of entries) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
  return [...counts].map(([reason, count]) => `${count} ${reasons[reason][count === 1 ? 0 : 1]}`).join(', ');
}

/** Bytes as MiB to one decimal, the unit every cache line is printed in. */
export function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * The debris inside one layer that stays: dead runs, stale scratch, old stories.
 *
 * Looked for where the writers put them — the layer itself and each declared
 * suite's directory — rather than by walking the layer, which holds record
 * stores of thousands of files.
 */
async function layer(
  path: string,
  owners: PruneOwners,
  drop: (path: string, reason: PruneReason) => Promise<void>,
): Promise<void> {
  const places = [path, ...(await directoriesIn(join(path, 'suites'))).map((suite) => join(path, 'suites', suite))];
  for (const place of places) {
    for (const name of await namesIn(place)) {
      const entry = join(place, name);
      const pid = scratchPid(name);
      if (pid !== null) {
        const touched = await mtimeOf(entry);
        if (touched === undefined || owners.now - touched < RUN_FLOOR_MS) continue;
        if (pid === undefined || !(await owners.alive(pid, touched))) await drop(entry, 'dead-run');
        continue;
      }
      if (name.endsWith('.stories')) {
        for (const story of await namesIn(entry)) {
          const file = join(entry, story);
          const touched = await mtimeOf(file);
          if (touched !== undefined && owners.now - touched > STORY_AGE_MS) await drop(file, 'old-story');
        }
      }
    }
  }
}

/**
 * When `pid` started, as the process table says, or undefined when it cannot.
 *
 * `lstart` is a calendar date in both BSD and procps `ps`, truncated to the
 * second, so it is the earliest the process can have started and a directory
 * written in that second is kept.
 */
function startedAt(pid: number): Promise<number | undefined> {
  return new Promise((resolve) => {
    execFile('ps', ['-o', 'lstart=', '-p', String(pid)], { env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
      const started = error ? NaN : Date.parse(stdout.trim());
      resolve(Number.isNaN(started) ? undefined : started);
    });
  });
}

/**
 * The process a scratch name belongs to: a number, `undefined` when the name is
 * scratch but carries no process, `null` when it is not scratch at all.
 */
export function scratchPid(name: string): number | undefined | null {
  const run = /^\.run-(\d+)-/u.exec(name);
  if (run !== null) return Number(run[1]);
  const temporary = /\.(\d+)[-.][^.]*\.tmp$/u.exec(name);
  if (temporary !== null) return Number(temporary[1]);
  const seed = /\.([0-9a-f]+)\.seed$/u.exec(name);
  if (seed !== null) return Number.parseInt(seed[1]!, 16);
  return name.endsWith('.tmp') ? undefined : null;
}

async function listedKeys(primary: string, owners: PruneOwners): Promise<ReadonlySet<string> | undefined> {
  const paths = await owners.worktrees(primary);
  if (paths === undefined) return undefined;
  const keys = new Set<string>();
  for (const path of paths) {
    keys.add(checkoutKey(path));
    try {
      keys.add(checkoutKey(realpathSync(path)));
    } catch { /* gone from disk; git will call it prunable */ }
  }
  return keys;
}

/** The worktrees git lists for `primary`, less the ones git itself calls prunable. */
function listWorktrees(primary: string): Promise<readonly string[] | undefined> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['worktree', 'list', '--porcelain'],
      { cwd: primary, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (error, stdout) => {
        if (error !== null) {
          resolve(undefined);
          return;
        }
        const listed: string[] = [];
        for (const block of stdout.split(/\n\n/u)) {
          const path = /^worktree (.+)$/mu.exec(block)?.[1];
          if (path !== undefined && !/^prunable\b/mu.test(block)) listed.push(path);
        }
        resolve(listed);
      },
    );
  });
}

/** Whether anything under `path` was written after `since`. Stops at the first that was. */
async function writtenSince(path: string, since: number): Promise<boolean> {
  const touched = await mtimeOf(path);
  if (touched === undefined) return false;
  if (touched > since) return true;
  let found;
  try {
    found = await readdir(path, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of found) {
    const child = join(path, entry.name);
    if (entry.isDirectory() ? await writtenSince(child, since) : ((await mtimeOf(child)) ?? 0) > since) return true;
  }
  return false;
}

/** The bytes a file or a directory holds, counted file by file; 0 for what is not there. */
export async function bytesUnder(path: string): Promise<number> {
  let found;
  try {
    found = await lstat(path);
  } catch {
    return 0;
  }
  if (!found.isDirectory()) return found.size;
  let total = 0;
  for (const name of await namesIn(path)) total += await bytesUnder(join(path, name));
  return total;
}

async function mtimeOf(path: string): Promise<number | undefined> {
  try {
    return (await lstat(path)).mtimeMs;
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

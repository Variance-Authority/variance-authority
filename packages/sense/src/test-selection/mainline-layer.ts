/**
 * The mainline's record as this machine last fetched it: where it is kept, and
 * which copy a run lays under its own before it lands.
 *
 * The CLI fetches: the share's store and formats are its, and a runner seam
 * cannot import them. A seam lays: the first run in a checkout lands on the own
 * layer, so the base has to be there before it does, or a plain `yarn test` in
 * a fresh worktree gets the primary checkout's record. A seam never fetches.
 *
 * They meet here. A fetch keeps the record at
 * `<cache>/share/read/<suite>/<commit>/`, in the cache every checkout of the
 * repository shares, and names it in `fetched.json` there. Each reader picks
 * the kept record its own `HEAD` holds. A record fetched for one mainline
 * answers nothing about another, and only the CLI can say which is selected,
 * so {@link lastFetchedMainline} takes that from a reader that worked it out.
 */

// compass: variance-authority.reach

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { cacheRootFor, listWorktrees, primaryCacheRoot, primaryCheckout } from './cache-layers.js';
import { commitRunsIn, commitRunsText } from './commit-runs-text.js';
import { commitRunsFile, type CommitRuns } from './commit-runs.js';
import { caseSectionsOf } from './case-record.js';
import { decodeExecutionTests } from './execution-format.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { openTestCoverage } from './format-view.js';
import type { IndexLock } from './index-lock.js';
import { pinOf, writeOwnLayer } from './own-layer.js';
import { repositoryRoot } from './repository-root.js';
import { declaredSuites, onlySuite } from './suites.js';

/** The file a fetch names the mainline's record in, beside the commit directories it keeps, and in each of them. */
export const FETCHED_MAINLINE = 'fetched.json';

/** What {@link FETCHED_MAINLINE} holds. */
export interface FetchedMainline {
  /** The mainline the record was read from. */
  readonly mainline: string;
  /** The commit the mainline published it at, and the directory it is kept in. */
  readonly commit: string;
  /** When it was fetched, as an ISO time. */
  readonly fetched: string;
  /** `HEAD`'s merge base with the mainline when the line was asked; absent when the clone named none. */
  readonly base?: string;
  /** Another job of this run read it and handed it on: the run's answer, which no reader in it asks the line past. */
  readonly handed?: true;
  /** The mainline's entry was marked partial: the run behind it ran part of the suite, and a whole one at the same commit replaces it. */
  readonly partial?: true;
  /** The share keeps only its latest record, which runs ahead of a merge base: the newest such fetch answers every checkout. */
  readonly latest?: true;
}

/** The mainline's record of one suite, as a fetch on this machine kept it. */
export interface LastFetched extends FetchedMainline {
  readonly suite: string;
  /** The record: its coverage, and its cases when the publishing run kept them. */
  readonly coverage: string;
  /** The runs record the publishing run wrote, when the entry carried one. */
  readonly runs?: string;
}

/** Where a fetch keeps one suite's mainline records: `<cacheRoot>/share/read/<suite>`. */
export function mainlineReadRoot(cacheRoot: string, suite: string): string {
  return join(cacheRoot, 'share', 'read', suite);
}

/**
 * Record that the mainline's record of `suite` was fetched into
 * `<readRoot>/<commit>/`: in that directory, which says what it holds to every
 * reader that picks it, and beside it, as the last fetch into this cache.
 * A fetch into another checkout's cache, `shared`, leaves a read handed to that
 * checkout standing there. A handed read is named beside them alone: it is that checkout's, and the
 * directory may be one every checkout picks from. Called by the fetch once
 * every file it keeps is in place, so a seam that reads this finds them.
 * Replaced whole, so no reader meets a half-written one.
 */
export async function writeFetchedMainline(cacheRoot: string, suite: string, fetched: FetchedMainline, shared = false): Promise<void> {
  const readRoot = mainlineReadRoot(cacheRoot, suite);
  const text = Buffer.from(`${JSON.stringify(fetched)}\n`);
  if (fetched.handed !== true) await place(join(readRoot, fetched.commit, FETCHED_MAINLINE), text);
  if (!shared || readFetchedMainline(readRoot)?.handed !== true) await place(join(readRoot, FETCHED_MAINLINE), text);
}

/** The pointer in one read root, or in one commit's directory under it, or undefined when there is none or it does not read. */
export function readFetchedMainline(readRoot: string): FetchedMainline | undefined {
  try {
    const value = JSON.parse(readFileSync(join(readRoot, FETCHED_MAINLINE), 'utf8')) as Partial<FetchedMainline>;
    if (typeof value.mainline !== 'string' || typeof value.commit !== 'string' || typeof value.fetched !== 'string') return undefined;
    const { mainline, commit, fetched, base, handed, partial, latest } = value;
    return {
      mainline,
      commit,
      fetched,
      ...(typeof base === 'string' ? { base } : {}),
      ...(handed === true ? { handed } : {}),
      ...(partial === true ? { partial } : {}),
      ...(latest === true ? { latest } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * The mainline record of `suite` for `root`'s `HEAD`: the first of
 * {@link keptMainlines} this build reads. A checkout a run handed its read
 * takes that read alone. Synchronous, as {@link nearestTestCoverage} cannot
 * wait.
 */
export function lastFetchedMainline(root: string, suite: string | undefined, cacheRoot?: string, selected?: string | null): LastFetched | undefined {
  if (selected === null) return undefined;
  const declared = declaredSuites(root);
  const name = suite ?? onlySuite(declared);
  if (name === undefined || declared?.find((one) => one.name === name)?.carry !== 'share') return undefined;
  // FIXME: a runner seam and a sense reader have no selection, so they take a record fetched for another mainline; moving the selection below the CLI closes it (#962).
  if (mainlineHanded(root, name, cacheRoot)) {
    const own = mainlineReadRoot(cacheRoot ?? cacheRootFor(repositoryRoot(root)), name);
    const pointer = readFetchedMainline(own);
    return pointer !== undefined && (selected === undefined || pointer.mainline === selected) ? fetchedRecord(own, pointer, name) : undefined;
  }
  for (const one of keptMainlines(root, name, cacheRoot, selected)) {
    const found = fetchedRecord(one.readRoot, one.pointer, name);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** How far back from `HEAD` one walk looks for a kept commit before each is asked alone. */
const WALK = 1000;

/**
 * The mainline records of `suite` kept for `root`, of `selected` when it is
 * named, across the shared cache and this checkout's own ({@link fetchStores}),
 * in the order a reader takes them. From a share that keeps only its latest,
 * the newest fetch first: that record runs ahead of every merge base. Then the
 * kept commits `HEAD` contains, nearest first, which are at or behind its
 * merge base with any mainline, so no selection is needed to find them, a
 * whole record before a partial one at the same commit. Then the rest, newest
 * fetch first. A handed read is no other checkout's, and is passed over.
 */
function keptMainlines(root: string, name: string, cacheRoot?: string, selected?: string): readonly { readonly readRoot: string; readonly pointer: FetchedMainline }[] {
  const kept: { readonly readRoot: string; readonly pointer: FetchedMainline }[] = [];
  const usable = (pointer: FetchedMainline | undefined): pointer is FetchedMainline => pointer !== undefined && pointer.handed !== true && (selected === undefined || pointer.mainline === selected);
  for (const cache of fetchStores(root, name, cacheRoot)) {
    const readRoot = mainlineReadRoot(cache, name);
    // A record kept before each directory named itself is named only beside them.
    const last = readFetchedMainline(readRoot);
    for (const commit of commitDirectories(readRoot)) {
      const pointer = readFetchedMainline(join(readRoot, commit)) ?? (last?.commit === commit ? last : undefined);
      if (usable(pointer)) kept.push({ readRoot, pointer });
    }
  }
  const behind = behindHead(repositoryRoot(root), new Set(kept.filter((one) => one.pointer.latest !== true).map((one) => one.pointer.commit)));
  const rank = (one: (typeof kept)[number]) => (one.pointer.latest === true ? -1 : behind.get(one.pointer.commit) ?? Infinity);
  const newest = (a: (typeof kept)[number], b: (typeof kept)[number]) => codeUnitOrder(b.pointer.fetched, a.pointer.fetched);
  return kept.sort((a, b) => {
    const [at, bt] = [rank(a), rank(b)];
    if (at !== bt) return at - bt;
    if (Number.isFinite(at) && at >= 0) return (a.pointer.partial === true ? 1 : 0) - (b.pointer.partial === true ? 1 : 0);
    return newest(a, b);
  });
}

/**
 * How many commits behind `HEAD` each of `commits` is, for those `HEAD`
 * contains: one walk of its last {@link WALK} commits, then one ask for those
 * it lacks among the rest. Those it holds past the walk follow it, newest
 * commit first: one ask orders them, where a count would walk history for
 * each. Absent for one git cannot place.
 */
function behindHead(checkout: string, commits: ReadonlySet<string>): ReadonlyMap<string, number> {
  const found = new Map<string, number>();
  if (commits.size === 0) return found;
  try {
    const walked = execFileSync('git', ['rev-list', `--max-count=${WALK}`, 'HEAD'], { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n');
    walked.forEach((commit, at) => {
      if (commits.has(commit)) found.set(commit, at);
    });
  } catch {
    return found;
  }
  const rest = [...commits].filter((commit) => !found.has(commit));
  if (rest.length === 0) return found;
  try {
    const lacked = new Set(execFileSync('git', ['rev-list', '--ignore-missing', '--stdin', '^HEAD'], { cwd: checkout, encoding: 'utf8', input: `${rest.join('\n')}\n`, stdio: ['pipe', 'pipe', 'ignore'] }).split('\n'));
    const held = rest.filter((commit) => !lacked.has(commit));
    if (held.length === 0) return found;
    const ordered = execFileSync('git', ['rev-list', '--no-walk', '--stdin'], { cwd: checkout, encoding: 'utf8', input: `${held.join('\n')}\n`, stdio: ['pipe', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
    ordered.forEach((commit, at) => found.set(commit, WALK + at));
  } catch {
    return found;
  }
  return found;
}

/** The commit directories under `readRoot`, or none when it cannot be read. */
function commitDirectories(readRoot: string): readonly string[] {
  try {
    return readdirSync(readRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^[0-9a-f]{7,64}$/u.test(entry.name)).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** Whether `older` is an ancestor of `newer` in `root`, or `undefined` when git cannot say. */
export function ancestor(root: string, older: string, newer: string): boolean | undefined {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', older, newer], { cwd: root, stdio: 'ignore' });
    return true;
  } catch (error) {
    return (error as { status?: number }).status === 1 ? false : undefined;
  }
}

/** The record `pointer` names under `readRoot`, when it is there and reads in this build. */
function fetchedRecord(readRoot: string, pointer: FetchedMainline, suite: string): LastFetched | undefined {
  const coverage = join(readRoot, pointer.commit, 'coverage.bin');
  if (!existsSync(coverage)) return undefined;
  const runs = commitRunsFile(coverage);
  const found: LastFetched = { ...pointer, suite, coverage, ...(existsSync(runs) ? { runs } : {}) };
  // One this build does not read, fetched by another version of it, is no
  // base: every reader passes it over here, rather than each checking again.
  return fetchedMainlineReads(found) ? found : undefined;
}

/**
 * The caches that hold `suite`'s fetched mainline records for `root`, in the
 * order a fetch tries to keep one: the one the caller named; this checkout's
 * own when a run handed it its read, which is that job's alone; else the
 * primary checkout's, so every checkout of the repository reads what one
 * fetched, then this checkout's own, for a worktree that may not write its
 * primary's. A record is keyed by the commit it was published at, so two
 * checkouts keeping one write the same bytes.
 */
export function fetchStores(root: string, suite: string, cacheRoot?: string): readonly string[] {
  if (cacheRoot !== undefined) return [cacheRoot];
  const here = repositoryRoot(root);
  const own = cacheRootFor(here);
  if (mainlineHanded(root, suite)) return [own];
  const shared = primaryCacheRoot(here);
  return shared === own ? [own] : [shared, own];
}

/**
 * The commits the checkouts of `root`'s repository read of each shared suite,
 * each by its own `HEAD`: the records a prune of the shared cache keeps. For
 * each, every record it ranks up to the first this build reads, so a pick
 * another build of a sibling reads is kept too. Absent when git cannot list
 * the checkouts, so a prune takes none of them.
 */
export async function pinnedMainlines(root: string): Promise<readonly string[] | undefined> {
  const checkouts = await listWorktrees(primaryCheckout(repositoryRoot(root)));
  if (checkouts === undefined) return undefined;
  const pinned = new Set<string>();
  for (const checkout of checkouts) {
    // Each checkout's own suites: a sibling may still carry one this checkout renamed.
    for (const { name } of (declaredSuites(checkout) ?? []).filter((one) => one.carry === 'share')) {
      for (const one of keptMainlines(checkout, name)) {
        pinned.add(one.pointer.commit);
        if (fetchedRecord(one.readRoot, one.pointer, name) !== undefined) break;
      }
    }
  }
  return [...pinned];
}

/**
 * Whether a run records the files it ran and nothing else, on no base: a shard
 * of a whole run, or of a selected run handed its read ({@link mainlineHanded}),
 * which the fan-in folds over that read. A selected shard handed none records
 * over its base, so its later wave selects from what its earlier one ran.
 */
export function recordsAlone(sharded: boolean, selected: boolean, handed: boolean): boolean {
  return sharded && (!selected || handed);
}

/**
 * Whether this checkout holds another job's read of `suite`, so no layer under
 * it answers: a handed miss leaves the mark alone, which names no record.
 */
export function mainlineHanded(root: string, suite: string | undefined, cacheRoot?: string): boolean {
  if (suite === undefined) return false;
  const readRoot = mainlineReadRoot(cacheRoot ?? cacheRootFor(repositoryRoot(root)), suite);
  try {
    return (JSON.parse(readFileSync(join(readRoot, FETCHED_MAINLINE), 'utf8')) as { handed?: unknown }).handed === true;
  } catch {
    return false;
  }
}

/**
 * Copy `record` into the own layer at `file`: the record unaltered, its cases
 * with it, and its runs record as a seed, and nothing else. Nothing is
 * laid over a record already there, and a record whose bytes this build does
 * not read is not laid. Says whether it laid.
 *
 * The runs record comes with the snapshot it describes, so the first run here
 * carries its `standing` forward rather than starting it again. It is laid
 * with `runs: 0`, as a seed from the primary checkout's is: the mainline's
 * runs are not this checkout's, so its first run at the same commit starts its
 * own change there rather than counting as one more of CI's — see `landRun` —
 * and a review before that run finds none listed. A runs record naming another
 * commit than its snapshot describes neither, and is not laid.
 * A runs record already in the own layer beside no snapshot describes
 * nothing, and is replaced or removed with the lay.
 */
export async function layFetchedMainline(record: LastFetched, lock: IndexLock): Promise<boolean> {
  const { file } = lock;
  // Held from here to the lay, so what a run lands is not laid over.
  try {
    await stat(file);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw error;
  }
  let coverage: Uint8Array;
  let runs: Uint8Array | undefined;
  try {
    coverage = await readFile(record.coverage);
    const held = opensFetched(coverage, record.runs === undefined ? undefined : await readFile(record.runs));
    runs = held === undefined ? undefined : seeded(held);
  } catch {
    return false;
  }
  // The runs record first and the snapshot last: a reader finds it by the
  // snapshot's path, and what is already beside it answers for it.
  await place(commitRunsFile(file), runs);
  await place(file, coverage);
  // The ledger names the milestone and no test of this checkout's yet.
  await writeOwnLayer(file, { pinned: pinOf(record), ran: [] });
  return true;
}

/**
 * Whether this build reads `record`, by the check {@link layFetchedMainline}
 * makes before it lays one, so a reader handed its path and the first run
 * here find the same base.
 */
function fetchedMainlineReads(record: LastFetched): boolean {
  try {
    opensFetched(
      readFileSync(record.coverage),
      record.runs === undefined ? undefined : readFileSync(record.runs),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Throws unless this build reads each part. Opening parses the section index
 * and nothing else, which is the whole of what "this build can read it" means;
 * the runs record reads when `commitRunsIn` reads it, a record written before
 * landings as one landing. Returns the runs record when it names the
 * snapshot's own commit. A record
 * whose run instrumented nothing reads, for its cases, and names no commit any
 * test stands at, so no runs record is laid beside it.
 */
export function opensFetched(
  coverage: Uint8Array,
  runs: Uint8Array | undefined,
): CommitRuns | undefined {
  let commit: string | undefined;
  try {
    commit = openTestCoverage(coverage).commit;
  } catch (error) {
    if (!(error instanceof RecordWithoutCoverage)) throw error;
  }
  const { index } = caseSectionsOf(coverage);
  if (index !== undefined && openSetExecutionIndex(index) === undefined) decodeExecutionTests(index);
  if (runs === undefined) return undefined;
  const held = commitRunsIn(Buffer.from(runs).toString('utf8'), 'the runs record');
  return commit !== undefined && held.commit === commit ? held : undefined;
}

/** `held` as the seed of a checkout that has not run: its runs are none of this checkout's, and landed when they landed. */
function seeded(held: CommitRuns): Uint8Array {
  return Buffer.from(commitRunsText({ ...held, runs: 0 }));
}

/** `bytes` at `file`, replaced whole so no reader meets a half-written one, or `file` gone when there are none. */
async function place(file: string, bytes: Uint8Array | undefined): Promise<void> {
  if (bytes === undefined) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, file);
}

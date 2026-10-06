/**
 * The mainline's record as this machine last fetched it: where it is kept, and
 * which copy a run lays under its own before it lands.
 *
 * A suite the root config gives to the share has one base, the record its
 * mainline's CI published, and every checkout measures from it. Two parties
 * touch that record and neither can do the other's part. The CLI fetches it:
 * the share's store, its lines and its entry formats are the CLI's, and a
 * runner seam cannot import them. A runner seam lays it: the first run in a
 * checkout lands on whatever is in the own layer, so the base has to be there
 * before the run lands. Waiting for the CLI to lay it would give a plain
 * `yarn test` in a fresh worktree the primary checkout's record instead.
 *
 * They meet here. A fetch keeps the record at
 * `<cache>/share/read/<suite>/<commit>/` and writes `fetched.json` beside the
 * commit directories, naming the mainline, the commit and when it was fetched.
 * A seam reads that file and nothing else of the share's, so the base a run
 * lays is the mainline's record as of the last fetch on this machine, by this
 * checkout or by the primary checkout it was cut from, whichever is newer. A
 * seam never fetches. When nothing has been fetched here, the run lays the
 * primary checkout's record as an offline fallback and says so.
 */

// compass: variance-authority.reach

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { cacheRootFor, primaryCheckout } from './cache-layers.js';
import { commitRunsFile, type CommitRuns } from './commit-runs.js';
import { caseSectionsOf } from './case-record.js';
import { decodeExecutionTests } from './execution-format.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { openTestCoverage } from './format-view.js';
import { writeOwnLayer } from './own-layer.js';
import { repositoryRoot } from './repository-root.js';
import { declaredSuites } from './suites.js';

/** The file a fetch names the mainline's record in, beside the commit directories it keeps. */
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
}

/** The mainline's record of one suite, as the last fetch on this machine kept it. */
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
 * `<readRoot>/<commit>/`. Called by the fetch once every file it keeps is in
 * place, so a seam that reads this finds them.
 */
export async function writeFetchedMainline(
  cacheRoot: string,
  suite: string,
  fetched: FetchedMainline,
): Promise<void> {
  const file = join(mainlineReadRoot(cacheRoot, suite), FETCHED_MAINLINE);
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}-${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(fetched)}\n`);
  await rename(temporary, file);
}

/** The pointer in one read root, or undefined when there is none or it does not read. */
export function readFetchedMainline(readRoot: string): FetchedMainline | undefined {
  try {
    const value = JSON.parse(readFileSync(join(readRoot, FETCHED_MAINLINE), 'utf8')) as Partial<FetchedMainline>;
    if (typeof value.mainline !== 'string' || typeof value.commit !== 'string' || typeof value.fetched !== 'string') return undefined;
    const { mainline, commit, fetched, base } = value;
    return { mainline, commit, fetched, ...(typeof base === 'string' ? { base } : {}) };
  } catch {
    return undefined;
  }
}

/**
 * The newest mainline record of `suite` fetched on this machine, or undefined
 * when the suite is not given to the share or nothing has been fetched.
 *
 * Two caches are asked: this checkout's and, in a worktree, the primary
 * checkout's, because each checkout fetches into its own cache and a worktree
 * cut this morning has fetched nothing. A caller that names `cacheRoot` asks
 * that one only, as {@link cacheLayers} reads both layers from it. A pointer
 * whose record is not on disk, or does not read in this build, is passed over.
 *
 * Synchronous, because {@link nearestTestCoverage} asks it and a caller of that
 * cannot wait. It opens the record, so a reader asks it only once the
 * checkout's own layer has none.
 */
export function lastFetchedMainline(root: string, suite: string | undefined, cacheRoot?: string): LastFetched | undefined {
  const declared = declaredSuites(root);
  const name = suite ?? (declared?.length === 1 ? declared[0]!.name : undefined);
  if (name === undefined || declared?.find((one) => one.name === name)?.carry !== 'share') return undefined;
  let newest: LastFetched | undefined;
  for (const cache of fetchCaches(root, cacheRoot)) {
    const readRoot = mainlineReadRoot(cache, name);
    const pointer = readFetchedMainline(readRoot);
    if (pointer === undefined || (newest !== undefined && newest.fetched >= pointer.fetched)) continue;
    const coverage = join(readRoot, pointer.commit, 'coverage.bin');
    if (!existsSync(coverage)) continue;
    const runs = commitRunsFile(coverage);
    const found: LastFetched = {
      ...pointer,
      suite: name,
      coverage,
      ...(existsSync(runs) ? { runs } : {}),
    };
    // One this build does not read, fetched by another version of it, is no
    // base: every reader passes it over here, rather than each checking again.
    if (fetchedMainlineReads(found)) newest = found;
  }
  return newest;
}

function fetchCaches(root: string, cacheRoot: string | undefined): readonly string[] {
  if (cacheRoot !== undefined) return [cacheRoot];
  const here = repositoryRoot(root);
  const own = cacheRootFor(here);
  const primary = cacheRootFor(primaryCheckout(here));
  return primary === own ? [own] : [own, primary];
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
export async function layFetchedMainline(record: LastFetched, file: string): Promise<boolean> {
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
  await writeOwnLayer(file, { pinned: { mainline: record.mainline, commit: record.commit }, ran: [] });
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
 * the runs record reads when it is a JSON object, as `readCommitRuns` has it.
 * Returns the runs record when it names the snapshot's own commit. A record
 * whose run instrumented nothing reads, for its cases, and names no commit any
 * test stands at, so no runs record is laid beside it.
 */
function opensFetched(
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
  const held: unknown = JSON.parse(Buffer.from(runs).toString('utf8'));
  if (typeof held !== 'object' || held === null || Array.isArray(held)) throw new Error('the runs record is not a JSON object');
  return commit !== undefined && (held as CommitRuns).commit === commit ? (held as CommitRuns) : undefined;
}

/** `held` as the seed of a checkout that has not run: its runs are none of this checkout's. */
function seeded(held: CommitRuns): Uint8Array {
  const at = new Date().toISOString();
  return Buffer.from(`${JSON.stringify({ ...held, first: at, latest: at, runs: 0 } satisfies CommitRuns, null, 2)}\n`);
}

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

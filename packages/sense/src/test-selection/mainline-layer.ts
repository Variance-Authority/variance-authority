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
import { commitRunsFile } from './commit-runs.js';
import { decodeExecutionTests } from './execution-format.js';
import { openSetExecutionIndex } from './execution-set-format.js';
import { openTestCoverage } from './format-view.js';
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
}

/** The mainline's record of one suite, as the last fetch on this machine kept it. */
export interface LastFetched extends FetchedMainline {
  readonly suite: string;
  /** The coverage record. */
  readonly coverage: string;
  /** Its per-case index, when the fetch kept one. */
  readonly cases?: string;
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
    return typeof value.mainline === 'string' && typeof value.commit === 'string' && typeof value.fetched === 'string'
      ? { mainline: value.mainline, commit: value.commit, fetched: value.fetched }
      : undefined;
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
 * whose record is not on disk is passed over.
 *
 * Synchronous, because {@link nearestTestCoverage} asks it and a caller of that
 * cannot wait: two small reads.
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
    const cases = `${coverage}.cases.bin`;
    const runs = commitRunsFile(coverage);
    newest = {
      ...pointer,
      suite: name,
      coverage,
      ...(existsSync(cases) ? { cases } : {}),
      ...(existsSync(runs) ? { runs } : {}),
    };
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
 * Copy `record` into the own layer at `file`: the coverage record, its case
 * index and its runs record, unaltered, and nothing else. Nothing is laid over
 * a record already there, and a record whose bytes this build does not read is
 * not laid. Says whether it laid.
 *
 * The runs record comes with the snapshot it describes, so the first run here
 * carries its `over` and `standing` forward rather than starting them again.
 * A case index or runs record already in the own layer beside no snapshot
 * describes nothing, and is replaced or removed with the lay.
 */
export async function layFetchedMainline(record: LastFetched, file: string): Promise<boolean> {
  try {
    await stat(file);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code !== 'ENOENT') throw error;
  }
  let coverage: Uint8Array;
  let cases: Uint8Array | undefined;
  let runs: Uint8Array | undefined;
  try {
    coverage = await readFile(record.coverage);
    cases = record.cases === undefined ? undefined : await readFile(record.cases);
    runs = record.runs === undefined ? undefined : await readFile(record.runs);
    opensFetched(coverage, cases, runs);
  } catch {
    return false;
  }
  // The index and the runs record first and the snapshot last: a reader finds
  // them by the snapshot's path, and what is already beside it answers for it.
  await place(`${file}.cases.bin`, cases);
  await place(commitRunsFile(file), runs);
  await place(file, coverage);
  return true;
}

/**
 * Whether this build reads `record`, by the check {@link layFetchedMainline}
 * makes before it lays one: a reader that would be handed its path skips a
 * record the first run would not lay, so both find the same base.
 *
 * Synchronous, for {@link nearestTestCoverage}, and asked only once the
 * checkout's own layer has no record, so it costs a read in a checkout that
 * has not run and nothing after.
 */
export function fetchedMainlineReads(record: LastFetched): boolean {
  try {
    opensFetched(
      readFileSync(record.coverage),
      record.cases === undefined ? undefined : readFileSync(record.cases),
      record.runs === undefined ? undefined : readFileSync(record.runs),
    );
    return true;
  } catch {
    return false;
  }
}

/** Throws unless this build reads each part. Opening parses the section index and nothing else, which is the whole of what "this build can read it" means. */
function opensFetched(coverage: Uint8Array, cases: Uint8Array | undefined, runs: Uint8Array | undefined): void {
  openTestCoverage(coverage);
  if (cases !== undefined && openSetExecutionIndex(cases) === undefined) decodeExecutionTests(cases);
  if (runs !== undefined) JSON.parse(Buffer.from(runs).toString('utf8'));
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

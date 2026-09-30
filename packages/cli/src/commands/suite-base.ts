// compass: variance-authority.reach
/**
 * The record a checkout measures a change from, read in one order:
 *
 * 1. **This checkout's own**, whenever a run here has landed one. It is the
 *    mainline's record plus everything this branch ran, and the fresher of the
 *    two.
 * 2. **The mainline's**, as CI published it, for a suite the root config gives
 *    to the share. It is one full run at the commit it names, the same record
 *    every other checkout and every pull request measures from.
 * 3. **The primary checkout's**, in a worktree that has run nothing, and only
 *    when the mainline's could not be read: the remote was unreachable, the
 *    line holds no record, or its bytes do not read. It is an offline fallback,
 *    and the reader says which of these happened.
 *
 * `mainlineBase` owns the fetch and the read layer it keeps the bytes in, and
 * `readableTestCoverage` owns which layer holds a record. This decides only
 * the order, and lays the mainline's record into this checkout's own layer when
 * a run is about to land on it.
 */

import { stat } from 'node:fs/promises';
import type { CommitRuns } from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { mainlineBase, type MainlineMissed, type MainlineRecord } from './mainline-base.js';

/** Which record a reader measures from, where it is, and why the others were passed over. */
export type SuiteBase =
  | { readonly from: 'own'; readonly suite?: string; readonly file: string }
  | { readonly from: 'mainline'; readonly suite: string; readonly file: string; readonly mainline: MainlineRecord }
  | { readonly from: 'primary'; readonly suite?: string; readonly file: string; readonly missed?: MainlineMissed }
  | { readonly from: 'none'; readonly suite?: string; readonly file: string; readonly missed?: MainlineMissed };

export interface SuiteBaseOptions {
  /** The declared suite; the one the root config declares when it declares one, and none when it declares none. */
  readonly suite?: string;
  readonly cacheRoot?: string;
  readonly env?: Env;
}

/**
 * The record `root` measures a change from, in the order this module's header
 * gives. `missed` is present when the suite is given to the share and its
 * mainline's record was not read, so the reader can say why the record it
 * holds is not that one. A `none` names this checkout's own path, the one a
 * run would write.
 */
export async function suiteBase(root: string, options: SuiteBaseOptions = {}): Promise<SuiteBase> {
  const selection = await import('@variance-authority/sense/test-selection');
  const suites = selection.declaredSuites(root);
  const suite = options.suite ?? onlySuite(suites);
  const declared = suites?.find((one) => one.name === suite);
  const named = { ...(suite === undefined ? {} : { suite }), ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }) };
  // Asked first so a suite the declaration does not carry, or no suite where
  // it declares several, is refused before anything is fetched.
  const own = selection.testCoverageFile(root, named);
  const at = suite === undefined ? {} : { suite };
  if (await exists(own)) return { from: 'own', ...at, file: own };

  const read = await mainlineBase(root, declared, {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  if (read !== undefined && !('miss' in read)) return { from: 'mainline', suite: read.suite, file: read.coverage, mainline: read };
  const missed = read === undefined ? {} : { missed: read };

  const nearest = await selection.readableTestCoverage(root, named);
  if (nearest !== own && (await exists(nearest))) return { from: 'primary', ...at, file: nearest, ...missed };
  return { from: 'none', ...at, file: own, ...missed };
}

/**
 * The runs the mainline's record stands for: one full run at the commit it was
 * published at, which is what a push to the mainline records, so every test in
 * it last ran there and none stands anywhere older. `first` and `latest` are
 * when it reached this checkout, because the publish carries no time.
 */
export async function mainlineRuns(record: MainlineRecord): Promise<CommitRuns> {
  const selection = await import('@variance-authority/sense/test-selection');
  const files = selection.askCoverageFile(record.coverage, (view) =>
    Array.from(view.testPath.all(), (path) => view.string(path)),
  );
  const at = new Date().toISOString();
  // Code-unit order, which is what the default comparison of two strings is.
  return { commit: record.commit, first: at, latest: at, runs: 1, files: [...new Set(files)].sort(), standing: [] };
}

/**
 * Lay the mainline's record into this checkout's own layer, where the next run
 * lands on it: the coverage record, its per-case index when the mainline
 * published one, and the runs record {@link mainlineRuns} describes.
 *
 * A run lays itself over whatever its own layer holds, so without this the
 * first run in a checkout would land on the primary checkout's record, which a
 * worktree copies up when it has none. The mainline's goes there first, and the
 * copy then finds a record and makes none. Nothing is laid over a record this
 * checkout already has: that one is the mainline's plus this branch's runs.
 * Returns the path laid, or `undefined` when there was already one there.
 */
export async function layMainline(
  root: string,
  record: MainlineRecord,
  options: { readonly cacheRoot?: string } = {},
): Promise<string | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  const own = selection.testCoverageFile(root, {
    suite: record.suite,
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  if (await exists(own)) return undefined;
  const { readFile } = await import('node:fs/promises');
  // The index first and the record last: a reader finds the record by its
  // path, and an index already beside it is the one it answers for.
  if (record.cases !== undefined) await selection.writeCoverageBytes(`${own}.cases.bin`, await readFile(record.cases));
  const runs = await mainlineRuns(record);
  await selection.writeCoverageBytes(selection.commitRunsFile(own), Buffer.from(`${JSON.stringify(runs, null, 2)}\n`));
  await selection.writeCoverageBytes(own, await readFile(record.coverage));
  return own;
}

/** The one suite a root config declares, which a reader that names none reads. */
function onlySuite(declared: readonly { readonly name: string }[] | undefined): string | undefined {
  return declared?.length === 1 ? declared[0]!.name : undefined;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false;
    throw error;
  }
}

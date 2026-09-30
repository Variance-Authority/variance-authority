// compass: variance-authority.reach
/**
 * The record a checkout measures a change from, read in one order:
 *
 * 1. **This checkout's own**, whenever a run here has landed one. It is the
 *    mainline's record plus everything this branch ran, and the fresher of the
 *    two.
 * 2. **The mainline's**, as CI published it, for a suite the root config gives
 *    to the share. It is published only when the runs record it carries shows
 *    the whole suite ran at the commit it names, and it is the same record
 *    every other checkout and every pull request measures from.
 * 3. **The primary checkout's**, in a worktree that has run nothing, and only
 *    when the mainline's could not be read: the remote was unreachable, the
 *    line holds no record, or its bytes do not read. It is an offline fallback,
 *    and the reader says which of these happened.
 *
 * `mainlineBase` owns the fetch and the read layer it keeps the bytes in, with
 * the runs record the publishing run carried beside them, and
 * `readableTestCoverage` owns which layer holds a record. This decides only
 * the order; the reader reads the mainline's record where the read layer
 * keeps it, and a run in this checkout records into its own layer above it.
 */

import { stat } from 'node:fs/promises';
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
 * Restore the mainline's record into a CI checkout's own layer, where the run
 * the job makes lands on it: the coverage record, its per-case index when the
 * mainline published one, and the runs record the publishing run wrote when
 * the entry carried it. Nothing is made up in place of a runs record the entry
 * did not carry, so a reader of the laid record says what it assumed.
 *
 * It is the carrier's restore, the one a cache-carried suite gets from the
 * Actions cache: a fresh CI checkout has no record, and a pull request's
 * selected run has to land on the one it was selected from so its coverage
 * counts every file. A developer's checkout, and a worktree above all, is never
 * seeded this way: its own layer sits above the read layer and holds only what
 * ran there, and `suiteBase` reads the mainline's where it lies. Nothing is laid
 * over a record the checkout already has. Returns the path laid, or
 * `undefined` when there was already one there.
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
  if (record.runs !== undefined) await selection.writeCoverageBytes(selection.commitRunsFile(own), await readFile(record.runs));
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

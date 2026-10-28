// compass: variance-authority.reach
/**
 * The record a checkout measures a change from, read in one order:
 *
 * 1. **This checkout's own**, whenever a run here has landed one. Its first
 *    run was laid on the base below it, so it is that base plus everything
 *    this branch ran since, and the fresher of the two. Its ledger says which
 *    milestone it stands on and which tests ran here; for a suite given to the
 *    share, a mainline record read now whose commit HEAD contains replaces the
 *    milestone under every test this checkout did not run (`repinOwnLayer`).
 * 2. **The mainline's**, as CI published it, for a suite the root config gives
 *    to the share: fetched now, or the record fetched last on this machine,
 *    which `mainlineBase` reuses for a while and falls back to when the remote
 *    does not answer. It is published only when the runs record it carries
 *    shows the whole suite ran at the commit it names, and it is the same
 *    record every other checkout and every pull request measures from.
 * 3. **The primary checkout's**, in a worktree that has run nothing, and only
 *    when no mainline record was read now or fetched earlier. It is an offline
 *    fallback, and the reader says why the mainline's is not it.
 *
 * A checkout's first run is laid on the same answer. The runner seams in
 * `@variance-authority/sense/test-selection` cannot fetch, so they lay the
 * mainline's record as last fetched here, else the primary checkout's, and say
 * which; `mainlineBase` is what leaves a fetched record where they look. So the
 * base a reader measures from and the base the first run lands on are one
 * record, and a checkout that has run keeps measuring from the mainline's,
 * moving forward with it as HEAD does.
 *
 * `mainlineBase` owns the fetch and the read layer it keeps the bytes in, with
 * the runs record the publishing run carried beside them, and
 * `readableTestCoverage` owns which layer holds a record. This decides only
 * the order.
 */

import { readFile, stat } from 'node:fs/promises';
import type { LastFetched, OwnLayer, Repin } from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { mainlineBase, type MainlineMissed, type MainlineRecord } from './mainline-base.js';

/** Which record a reader measures from, where it is, and why the others were passed over. */
export type SuiteBase =
  | {
      readonly from: 'own';
      readonly suite?: string;
      readonly file: string;
      /** The record's ledger after any re-pin; absent for a record laid before there was one. */
      readonly layer?: OwnLayer;
      /** What a fetched mainline record did to the pin, when one was read. */
      readonly repin?: Repin;
    }
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
 * gives. `missed` is present when the suite is given to the share and no
 * mainline record was read, so the reader can say why the record it holds is
 * not that one. A `none` names this checkout's own path, the one a run would
 * write.
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
  if (await exists(own)) {
    // The milestone under the checkout moves forward when the mainline's
    // newest record is one HEAD contains: see `repinOwnLayer`.
    const read = declared?.carry === 'share' ? await mainlineBase(root, declared, {
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    }) : undefined;
    const repin = read === undefined || 'miss' in read ? undefined : await selection.repinOwnLayer(own, fetchedOf(read), root);
    const layer = await selection.readOwnLayer(own);
    return { from: 'own', ...at, file: own, ...(layer === undefined ? {} : { layer }), ...(repin === undefined ? {} : { repin }) };
  }

  const read = await mainlineBase(root, declared, {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  if (read !== undefined && !('miss' in read)) return { from: 'mainline', suite: read.suite, file: read.coverage, mainline: read };
  const missed = read === undefined ? {} : { missed: read };

  // With no mainline record fetched here, the nearest layer under this
  // checkout's own is the primary checkout's, the same one a first run lays.
  const nearest = await selection.readableTestCoverage(root, named);
  if (nearest !== own && (await exists(nearest))) return { from: 'primary', ...at, file: nearest, ...missed };
  return { from: 'none', ...at, file: own, ...missed };
}

/**
 * Lay the mainline's record into a checkout's own layer, where the run it
 * makes next lands on it: the coverage record, which carries its cases,
 * unaltered, and the runs record as a seed with `runs: 0`, by the same
 * `layFetchedMainline` a runner seam lays it with. Nothing is made up in place
 * of a runs record the entry did not carry.
 *
 * A seam lays it on its own before a run lands, so a checkout needs this only
 * when something reads the own layer before the first run: CI's
 * `keep the base record` step copies the base aside before the suite layers
 * the change onto it. Nothing is laid over a record the checkout already has.
 *
 * `instrumentation` is the probes of the run that lands next. A record written
 * under other probes is passed over and returned as such, because that run
 * could not be laid over it (`foreignProbes`): laid, it would fail every run
 * that lands on it. `undefined` is a landing that lays no coverage, which lays
 * over a base under any probes.
 */
export async function layMainline(
  root: string,
  record: MainlineRecord,
  instrumentation: string | undefined,
  options: { readonly cacheRoot?: string } = {},
): Promise<MainlineLaid> {
  const selection = await import('@variance-authority/sense/test-selection');
  const own = selection.testCoverageFile(root, {
    suite: record.suite,
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
  });
  if (instrumentation !== undefined) {
    const bytes = await readFile(record.coverage).catch(() => undefined);
    const written = bytes === undefined ? undefined : selection.foreignProbes(bytes, instrumentation);
    if (written !== undefined) {
      return { passed: { suite: record.suite, file: record.coverage, instrumentation: written, run: instrumentation } };
    }
  }
  const laid = await selection.layFetchedMainline(fetchedOf(record), own);
  return laid ? { laid: own } : undefined;
}

/**
 * A mainline record {@link layMainline} did not lay: it was written under the
 * probes `instrumentation`, and the run about to land records under `run`, so
 * that run could not be laid over it.
 */
export interface MainlinePassedOver {
  readonly suite: string;
  /** The record passed over. */
  readonly file: string;
  /** The probes it was written under. */
  readonly instrumentation: string;
  /** The probes the run records under. */
  readonly run: string;
}

/**
 * What {@link layMainline} did: the path it laid the record at, or the record
 * it passed over for its probes; `undefined` when it laid nothing for any other
 * reason: the checkout has a record of its own, or this build does not read
 * the base.
 */
export type MainlineLaid = { readonly laid: string } | { readonly passed: MainlinePassedOver } | undefined;

/**
 * The note a reader gives for a mainline record {@link layMainline} passed over
 * for its probes: the record, the probes it was written under, and the probes
 * the run records under.
 */
export function mainlinePassedOver(passed: MainlinePassedOver): string {
  return `record of "${passed.suite}": the mainline's record at ${passed.file} was written under the probes ` +
    `\`${passed.instrumentation}\`, and this run records under \`${passed.run}\`, so no run here can be laid over it ` +
    'and it was not laid';
}

/** A read of the mainline, as the seams name what was fetched. */
function fetchedOf(record: MainlineRecord): LastFetched {
  return {
    suite: record.suite,
    mainline: record.mainline,
    commit: record.commit,
    fetched: record.fetched,
    coverage: record.coverage,
    ...(record.runs === undefined ? {} : { runs: record.runs }),
  };
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

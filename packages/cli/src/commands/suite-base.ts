// compass: variance-authority.reach
/**
 * The record a checkout measures a change from, read in one order:
 *
 * 1. **This checkout's own**, whenever a run here has landed one: the base below
 *    it plus everything this branch ran since, and the fresher of the two.
 * 2. **The mainline's**, as CI published it, for a suite the root config gives
 *    to the share: fetched now, or fetched last for the mainline selected.
 * 3. **The primary checkout's**, in a worktree that has run nothing, when no
 *    record of the selected mainline was read. It is an offline fallback, and
 *    the reader says why the mainline's is not it.
 *
 * A checkout's first run is laid from what `lastFetchedMainline` gives a seam,
 * which has no selection to judge it by. `mainlineBase` owns the fetch and
 * `readableTestCoverage` which layer holds a record; this decides the order,
 * and says whose it gave.
 */

import { readFile } from 'node:fs/promises';
import type { LastFetched, OwnLayer, Repin } from '@variance-authority/sense/test-selection';
import type { Env } from '../share-lines.js';
import { checkoutRead } from './checkout-read.js';
import { mainlineBase, mainlineMissed, mainlineRead, primaryRead, type MainlineAsk, type MainlineMissed, type MainlineRecord } from './mainline-base.js';
import { recordHeld } from './mainline-selected.js';
import { namedSuite, onlySuite, recordedSuite } from './suite-record.js';

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
  /** See {@link MainlineAsk.fetch}. Under `'never'` a checkout's own record is not repinned either. */
  readonly fetch?: MainlineAsk['fetch'];
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
  const ask: MainlineAsk = {
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  };
  if (await recordHeld(own)) {
    // The milestone under the checkout moves forward when the mainline's
    // newest record is one HEAD contains: see `repinOwnLayer`. A read that
    // fetches nothing can be killed mid-way, so it rewrites nothing either.
    const read = declared?.carry === 'share' && options.fetch !== 'never' ? await mainlineBase(root, declared, ask) : undefined;
    const repin = read === undefined || 'miss' in read ? undefined : await selection.repinOwnLayer(own, fetchedOf(read), root);
    const layer = await selection.readOwnLayer(own);
    return { from: 'own', ...at, file: own, ...(layer === undefined ? {} : { layer }), ...(repin === undefined ? {} : { repin }) };
  }

  const read = await mainlineBase(root, declared, ask);
  if (read !== undefined && !('miss' in read)) return { from: 'mainline', suite: read.suite, file: read.coverage, mainline: read };
  const missed = read === undefined ? {} : { missed: read };

  // With no mainline record fetched here, the nearest layer under this
  // checkout's own is the primary checkout's, the same one a first run lays.
  // A miss names the mainline selected, so nothing fetched for another answers.
  const nearest = await selection.readableTestCoverage(root, { ...named, selected: read?.mainline });
  if (nearest !== own && (await recordHeld(nearest))) return { from: 'primary', ...at, file: nearest, ...missed };
  return { from: 'none', ...at, file: own, ...missed };
}

/**
 * Whose record was read, for a suite given to a share: this checkout's own, or
 * the one its mainline published. Absent for any other suite, which has only
 * the one record and nothing to tell apart.
 */
export interface RecordSource {
  /** Absent when neither had one. */
  readonly from?: 'checkout' | 'mainline';
  /** The mainline asked, when one was. */
  readonly mainline?: string;
  /** How far the mainline's record is behind this checkout's merge base with it; negative when ahead. */
  readonly distance?: number;
  /** Which record was read: `select`'s first note, the line `covering`'s text opens with, and a line on stderr beside its `--format refs`. */
  readonly says: string;
}

/** The record a reader was given, whether it is there, whose it is, and why the mainline's is not it. */
export interface FoundRecord {
  readonly at: string;
  readonly held: boolean;
  readonly source?: RecordSource;
  /** Present when the share was asked and gave no record. */
  readonly missed?: MainlineMissed;
}

/**
 * The record of the suite this checkout measures from, in the order `suiteBase` gives every base
 * reader: this checkout's own, else the mainline's (ADR-0084), else, in a worktree, the primary
 * checkout's as the offline fallback.
 *
 * A suite the root config does not give to a share has no mainline record, and reads the nearest
 * layer that holds one. For a suite given to a share the answer says whose record it read, because
 * they answer differently and a list alone does not say which.
 */
export async function recordedOrMainline(
  request: { readonly root: string; readonly suite?: string },
  options: Pick<SuiteBaseOptions, 'fetch'> = {},
): Promise<FoundRecord> {
  const { declared } = await namedSuite(request.root, request.suite);
  if (declared?.carry !== 'share') {
    const { file } = await recordedSuite(request.root, request.suite);
    return { at: file, held: await recordHeld(file) };
  }
  const suite = declared.name;
  const base = await suiteBase(request.root, { suite, ...options });
  if (base.from === 'own') return { at: base.file, held: true, source: { from: 'checkout', says: await checkoutRead(suite, request.root, base) } };
  if (base.from === 'mainline') {
    const read = base.mainline;
    const distance = read.distance === undefined ? {} : { distance: read.distance };
    return { at: read.coverage, held: true, source: { from: 'mainline', mainline: read.mainline, ...distance, says: mainlineRead(read) } };
  }
  const mainline = base.missed?.mainline === undefined ? {} : { mainline: base.missed.mainline };
  if (base.from === 'primary') {
    const missed = base.missed === undefined ? {} : { missed: base.missed };
    return { at: base.file, held: true, source: { from: 'checkout', ...mainline, says: primaryRead(suite, base.file, base.missed) }, ...missed };
  }
  if (base.missed === undefined) return { at: base.file, held: false };
  return { at: base.file, held: false, source: { ...mainline, says: mainlineMissed(base.missed) }, missed: base.missed };
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
  const laid = await selection.withIndexLock(own, (lock) => selection.layFetchedMainline(fetchedOf(record), lock));
  if (!laid.held) throw new Error(selection.busyIndex(own));
  return laid.value ? { laid: own } : undefined;
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

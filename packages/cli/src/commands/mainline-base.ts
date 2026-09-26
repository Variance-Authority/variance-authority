// compass: variance-authority.reach
/**
 * The record a base reader reads when this checkout recorded none: the one its
 * mainline published.
 *
 * `review` and `select` measure a change from a base. A base taken from the
 * branch's own record would measure the change against itself, so the
 * mainline is the only line read. This checkout's own recording wins whenever
 * there is one, and the mainline is asked only for a suite the root config
 * gives to the share: `select` asks when this checkout has no recording of the
 * suite, and `review` when the runs here were laid over no recording and no
 * `--since` names a base.
 *
 * The bytes go into a read layer of their own, `share/read/<suite>/<commit>/`
 * in the cache, beneath every layer a run writes. A run never records over it,
 * and a reader of this checkout's recording never finds it there, so the
 * record the mainline published is never read as the record this checkout ran.
 * It is addressed by commit, like every record in the cache, so a second read
 * of the same commit writes the same bytes to the same place.
 */

import { rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DeclaredSuite, RootConfig } from '@variance-authority/sense/test-selection';
import { parseShare } from '../config-share.js';
import { ConfigError, messageOf } from '../config-values.js';
import type { Env } from '../share-lines.js';
import { executionIndexOf } from './execution-input.js';
import { shareRoot } from './resources.js';
import { describeDistance, describeMiss, mainlineSuite, type MainlineMiss } from './share.js';

/** The mainline's record of one suite, written where this checkout reads it. */
export interface MainlineRecord {
  readonly suite: string;
  readonly mainline: string;
  /** The commit the mainline published the record at. */
  readonly commit: string;
  /** Commits the record is behind `HEAD`'s merge base with the mainline; negative when ahead. Absent when this clone cannot count. */
  readonly distance?: number;
  /** The coverage record, in the read layer. */
  readonly coverage: string;
  /** Its per-case index, when the run that published it wrote one and it reads. */
  readonly cases?: string;
  /** Why the per-case index it published is not kept, when it published one that does not read. */
  readonly casesUnread?: string;
}

/** Why the mainline gave no record: which mainline was asked, when one was known, and the share's answer. */
export interface MainlineMissed {
  readonly suite: string;
  readonly mainline?: string;
  readonly miss: MainlineMiss;
  /** The entries the mainline holds when it holds none for this suite. */
  readonly holds?: readonly string[];
  /** `false` when the root config's `share` section stopped the read before the share was asked. */
  readonly shareAsked?: false;
}

export type MainlineBase = MainlineRecord | MainlineMissed;

/**
 * The record `declared`'s mainline published, or why there is none.
 *
 * `undefined` when the suite is not given to the share: then there is no
 * second record, and a reader says nothing about one. Everything else that
 * stops the read — a share section this machine cannot use, a record that
 * cannot be kept, bytes this version does not read — is a miss the reader
 * names, because the reader still has an answer without the record: `select`
 * runs every test, and `review` asks for `--since`.
 */
export async function mainlineBase(
  root: string,
  declared: DeclaredSuite | undefined,
  here: { readonly env?: Env } = {},
): Promise<MainlineBase | undefined> {
  if (declared?.carry !== 'share') return undefined;
  const suite = declared.name;
  const selection = await import('@variance-authority/sense/test-selection');
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(selection.rootConfig(root));
  } catch (error) {
    // A section that does not parse. An unset token is not one of these: it is
    // read when the share is asked, and arrives as that share's miss.
    if (!(error instanceof ConfigError)) throw error;
    return { suite, miss: { kind: 'unconfigured', detail: error.message }, shareAsked: false };
  }
  const place = { ...(share === undefined ? {} : { share }), cacheRoot: selection.cacheRootFor(root) };
  const found = await mainlineSuite(place, suite, { ...here, cwd: root });
  if ('miss' in found) return { suite, ...found };
  const unread = (detail: string): MainlineMissed => ({ suite, mainline: found.mainline, miss: { kind: 'unreadable', detail } });

  const layer = join(shareRoot(place), 'read', suite, found.commit);
  const coverage = join(layer, 'coverage.bin');
  const kept = await keep(selection.writeCoverageBytes, coverage, found.coverage);
  if (kept !== undefined) return unread(`the record published at ${found.commit} could not be kept at ${coverage}: ${kept}`);
  const refused = refusal(selection.askCoverageFile, coverage, found.commit);
  if (refused !== undefined) {
    await rm(layer, { recursive: true, force: true });
    return unread(refused);
  }

  // Beside the record, under the name every reader of a record looks for its cases by.
  const cases = `${coverage}.cases.bin`;
  let casesUnread: string | undefined;
  if (found.cases !== undefined) {
    casesUnread = decodes(found.cases);
    if (casesUnread === undefined) {
      const failed = await keep(selection.writeCoverageBytes, cases, found.cases);
      if (failed !== undefined) casesUnread = `its per-case index could not be kept at ${cases}: ${failed}`;
    }
  }
  return {
    suite,
    mainline: found.mainline,
    commit: found.commit,
    ...(found.distance !== undefined ? { distance: found.distance } : {}),
    coverage,
    ...(found.cases !== undefined && casesUnread === undefined ? { cases } : {}),
    ...(casesUnread !== undefined ? { casesUnread } : {}),
  };
}

/** Write `bytes` at `path`, or the error that stopped them being kept there. */
async function keep(
  write: (path: string, bytes: Uint8Array) => Promise<void>,
  path: string,
  bytes: Uint8Array,
): Promise<string | undefined> {
  try {
    await write(path, bytes);
    return undefined;
  } catch (error) {
    return messageOf(error);
  }
}

/**
 * Why the kept record cannot be a base, or `undefined` when it can.
 *
 * Asked of the record, because the record owns the commit its regions are
 * coordinates in. `recordedCommit` answers `undefined` both for a record that
 * names no commit and for bytes this build does not read; those are fixed in
 * different places, so the reader is opened here to tell them apart. A record
 * recorded at one commit and published at another is refused too: `select`
 * would measure from the first and `review` start at the second, and the two
 * would not agree on what changed.
 */
function refusal(
  ask: (file: string, question: (view: { readonly commit?: string | undefined }) => string | undefined) => string | undefined,
  file: string,
  published: string,
): string | undefined {
  let recorded: string | undefined;
  try {
    recorded = ask(file, (view) => view.commit);
  } catch (error) {
    return `the record published at ${published} does not read: ${messageOf(error)}`;
  }
  if (recorded === undefined) {
    return `the record published at ${published} names no commit, so there is no coordinate to measure a diff from`;
  }
  if (recorded !== published) {
    return `the record published at ${published} was recorded at ${recorded}, so its regions are not coordinates in the commit it was published at`;
  }
  return undefined;
}

/** Why a published case index does not read, or `undefined` when it does. */
function decodes(bytes: Uint8Array): string | undefined {
  try {
    executionIndexOf(bytes);
    return undefined;
  } catch (error) {
    return `its per-case index does not read (${messageOf(error)}), so it is not kept`;
  }
}

/**
 * The root config's `share`, where a suite declared beside it is published.
 *
 * Read from the root file because that is where the suites are declared: the
 * CLI refuses a suite given to a share in a file with no `share` section.
 */
function rootShare(config: RootConfig | undefined) {
  const value = config?.value['share'];
  if (config === undefined || value === undefined) return undefined;
  return parseShare(value, { source: config.file, baseDir: dirname(config.file) });
}

/**
 * The note that says the mainline's record was read: which mainline, which
 * commit, how far off, and where it is kept. It is the first note, after the
 * reader's own verdict.
 */
export function mainlineRead(read: MainlineRecord): string {
  return `record of "${read.suite}": read from mainline ${read.mainline}, published at ${read.commit}, ` +
    `${describeDistance(read.distance)}; kept at ${read.coverage}` +
    (read.casesUnread === undefined ? '' : `; ${read.casesUnread}`);
}

/**
 * The note a reader gives when this checkout has no record and the mainline's
 * was not read. "None either" only when the share answered that it holds none:
 * a refusal or an unreachable share says nothing about what was published. The
 * line is named the way `variance share` names it, and a share section that
 * stopped the read says so instead, because then no line was asked.
 */
export function mainlineMissed(missed: MainlineMissed): string {
  const said = describeMiss(missed.miss, missed.holds);
  if (missed.shareAsked === false) return `record of "${missed.suite}": the share was not asked; ${said}`;
  const opening = missed.miss.kind === 'absent' ? 'the share has none either' : "the mainline's was not read";
  const line = missed.mainline === undefined ? 'no mainline' : `mainline ${missed.mainline}`;
  return `record of "${missed.suite}": ${opening}; ${line}: ${said}`;
}

/** The note a reader gives when this checkout's own record won over the mainline's. */
export function checkoutRead(suite: string): string {
  return `record of "${suite}": read from this checkout; the mainline's is read only when this checkout has none`;
}

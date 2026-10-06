// compass: variance-authority.reach
/**
 * The mainline's record of a suite: fetched, kept where every reader and every
 * runner seam on this machine finds it, and reused for a while.
 *
 * `review` and `select` measure a change from a base, and a base taken from the
 * branch's own record would measure the change against itself, so the mainline
 * is the only line read. It is asked only for a suite the root config gives to
 * the share. `suiteBase` orders it against this checkout's own record and the
 * primary checkout's.
 *
 * The bytes go into a read layer of their own, `share/read/<suite>/<commit>/`
 * in the cache, beneath every layer a run writes, and a `fetched.json` beside
 * the commit directories names the one fetched last. That file is where the
 * fetch hands the record to the runner seams in
 * `@variance-authority/sense/test-selection`: a checkout's first run lays that
 * copy under its own layer and lands on it, so a plain `yarn test` measures
 * from the same record this reads. A run never records over the read layer.
 * It is addressed by commit, like every record in the cache, so a second read
 * of the same commit writes the same bytes to the same place.
 *
 * A fetch costs a round trip to the remote, and on a network that hangs, the
 * whole of the store's timeout. So the record fetched last, by this checkout or
 * by the primary checkout it was cut from, is reused for
 * {@link MAINLINE_REUSE_MS} while the reader's mainline is still the one it was
 * fetched from. A line that gave no record, because it could not be reached,
 * held none, or held one this version cannot keep, is not asked again for as
 * long either: its answer stands, and the note says when it was given. Every
 * reader of a sitting, and every job of a CI run handed the read root, reads
 * the same answer, never a record the line came to hold in between. Past that
 * the mainline is asked again, and when it does not answer, the record fetched
 * last is still the base, and the note says why it was not refreshed.
 * `variance share --suite <name>` always asks.
 *
 * Past the window, a workstation does not wait for that ask. A reader given a
 * {@link Detach} answers from the record fetched last and starts
 * `share --suite <name>` as a process of its own, under a lock in the read root,
 * so a second reader in the meantime starts none; the command run after that
 * process ends reads what it fetched. `bin.ts` passes one only outside CI, so
 * a CI job, and every caller of the library, asks before it answers. The first
 * fetch, with nothing fetched earlier, is always asked before the answer.
 */

import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { DeclaredSuite, LastFetched, RootConfig } from '@variance-authority/sense/test-selection';
import { parseShare } from '../config-share.js';
import type { Config } from '../config.js';
import { ConfigError, messageOf } from '../config-values.js';
import { distanceFrom, readerMainline, type Env } from '../share-lines.js';
import { executionIndexOf } from './execution-input.js';
import { releaseLock, type Detach, type ProcessLock } from './detached.js';
import { mainlineRefreshLock, refreshing, refreshMainline } from './mainline-refresh.js';
import { CACHE_PRUNE_REASONS, checkoutOwners, pruneCacheWhenDue } from './prune-cache.js';
import { describeDistance, describeMiss, mainlineSuite, type MainlineMiss } from './share.js';

/**
 * How long the record fetched last stands for the mainline's without asking the
 * remote again, and how long the line's answer that it gave none stands.
 *
 * Long enough that an edit loop of `yarn test:since` asks once, and short
 * enough that a record `main` published while you worked arrives in the same
 * sitting. The mainline moves on the order of merges, not seconds.
 */
export const MAINLINE_REUSE_MS = 10 * 60_000;

/** Where a checkout notes that the line was asked and gave no record, beside `fetched.json`. */
const MISSED = 'missed.json';

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
  /** The record again, when it carries a case index that reads. */
  readonly cases?: string;
  /** Why the per-case index it published is not kept, when it published one that does not read. */
  readonly casesUnread?: string;
  /** The runs record the publishing run wrote, beside the record, when the entry carried one. */
  readonly runs?: string;
  /** When it was fetched, as an ISO time: now, unless it is the record fetched earlier. */
  readonly fetched: string;
  /**
   * Present when it is the record fetched earlier: reused within the window,
   * kept because the mainline gave no record, now or, as `asked` says, earlier
   * within the window, or past the window while `refreshing` names the process
   * that is fetching the mainline's.
   */
  readonly earlier?:
    | { readonly reused: true }
    | { readonly unanswered: MainlineMiss; readonly asked?: string }
    | { readonly refreshing: ProcessLock };
  /** What the fetch's daily prune of this cache took, when it took something. */
  readonly pruned?: string;
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
  /** When the line gave this answer, as an ISO time, when it was earlier within the window and not now. */
  readonly asked?: string;
}

/** The line's answer that it gave no record: which mainline, when, and why. */
export interface MissedMainline {
  readonly mainline: string;
  /** When the line was asked, as an ISO time. */
  readonly at: string;
  readonly miss: MainlineMiss;
  readonly holds?: readonly string[];
}

export type MainlineBase = MainlineRecord | MainlineMissed;

/** How a base reader asks. */
export interface MainlineAsk {
  readonly env?: Env;
  readonly cacheRoot?: string;
  /** Ask the remote whatever was fetched and whenever: `variance share --suite <name>`. */
  readonly refetch?: boolean;
  /** The clock, for a test. */
  readonly now?: number;
  /**
   * Past the window, start the fetch as a process of its own and answer from
   * the record fetched last. Absent, the fetch is made before the answer.
   */
  readonly detach?: Detach;
}

/**
 * The record `declared`'s mainline published, or why there is none.
 *
 * `undefined` when the suite is not given to the share: then there is no
 * second record, and a reader says nothing about one. Everything else that
 * stops the read — a share section this machine cannot use, a record that
 * cannot be kept, bytes this version does not read — is a miss the reader
 * names, because the reader still has an answer without the record: `select`
 * runs every test, and `review` asks for `--since`. When a record was fetched
 * earlier, a miss is not the answer: that record is, and it carries the miss.
 */
export async function mainlineBase(
  root: string,
  declared: DeclaredSuite | undefined,
  here: MainlineAsk = {},
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
  const cacheRoot = here.cacheRoot ?? selection.cacheRootFor(root);
  const place = { ...(share === undefined ? {} : { share }), cacheRoot };
  const env = here.env ?? process.env;
  const now = here.now ?? Date.now();
  const readRoot = selection.mainlineReadRoot(cacheRoot, suite);
  // Both caches when the caller named none, as a runner seam reads them.
  const last = selection.lastFetchedMainline(root, suite, here.cacheRoot);

  if (here.refetch !== true) {
    const chosen = await readerMainline(place, env, root);
    const mainline = 'missing' in chosen ? undefined : chosen.name;
    if (last !== undefined && last.mainline === mainline && now - Date.parse(last.fetched) < MAINLINE_REUSE_MS) {
      return earlier(place, root, last, { reused: true });
    }
    const noted = readMissedMainline(readRoot);
    if (noted !== undefined && noted.mainline === mainline && now - Date.parse(noted.at) < MAINLINE_REUSE_MS) {
      if (last !== undefined) return earlier(place, root, last, { unanswered: noted.miss, asked: noted.at });
      return { suite, mainline: noted.mainline, miss: noted.miss, ...(noted.holds === undefined ? {} : { holds: noted.holds }), asked: noted.at };
    }
    if (here.detach !== undefined && last !== undefined && last.mainline === mainline) {
      const started = refreshMainline(readRoot, suite, here.detach);
      if (started !== undefined) return earlier(place, root, last, { refreshing: started });
    }
  }

  try {
    return await fetchNow({ root, suite, place, env, readRoot, last, now }, selection);
  } finally {
    // The process `refreshMainline` started holds the lock until this fetch is done;
    // so does a reader whose process could not be started.
    releaseLock(mainlineRefreshLock(readRoot).path, process.pid);
  }
}

/** What a fetch of the mainline's record is asked with. */
interface Fetching {
  readonly root: string;
  readonly suite: string;
  readonly place: Pick<Config, 'share'> & { readonly cacheRoot: string };
  readonly env: Env;
  readonly readRoot: string;
  readonly last: LastFetched | undefined;
  readonly now: number;
}

/** Ask the mainline for its record now, and keep it where every reader looks, or say why there is none. */
async function fetchNow(
  { root, suite, place, env, readRoot, last, now }: Fetching,
  selection: typeof import('@variance-authority/sense/test-selection'),
): Promise<MainlineBase> {
  const { cacheRoot } = place;
  const asked = new Date(now).toISOString();
  const found = await mainlineSuite(place, suite, { env, cwd: root });
  if ('miss' in found) {
    // With no mainline, or no credential, the line was not asked: that is this
    // environment's answer, not the line's, and the next reader in the same
    // environment finds it the same way, or in a fixed one finds the line.
    if (found.mainline !== undefined && found.miss.kind !== 'unconfigured') {
      const { miss, holds } = found;
      await noteMissed(readRoot, { mainline: found.mainline, at: asked, miss, ...(holds === undefined ? {} : { holds }) });
    }
    if (last !== undefined) return earlier(place, root, last, { unanswered: found.miss });
    return { suite, ...found };
  }
  const unread = async (detail: string): Promise<MainlineMissed> => {
    const miss: MainlineMiss = { kind: 'unreadable', detail };
    await noteMissed(readRoot, { mainline: found.mainline, at: asked, miss });
    return { suite, mainline: found.mainline, miss };
  };

  const layer = join(readRoot, found.commit);
  const coverage = join(layer, 'coverage.bin');
  // The cases travel in the record. An index that does not read is dropped
  // from it, so no reader of the kept record meets it.
  let index: Uint8Array | undefined;
  try {
    index = selection.caseSectionsOf(found.coverage).index;
  } catch (error) {
    return await unread(`the record published at ${found.commit} does not read: ${messageOf(error)}`);
  }
  const casesUnread = index === undefined ? undefined : decodes(index);
  const record = casesUnread === undefined ? selection.sharedRecord(found.coverage) : selection.withCaseSections(found.coverage, {});
  const kept = await keep(selection.writeCoverageBytes, coverage, record);
  if (kept !== undefined) return await unread(`the record published at ${found.commit} could not be kept at ${coverage}: ${kept}`);
  // A record of cases alone was published by a run that instrumented no module.
  // The share kept the run that names its commit off the line, and the publisher
  // checked that commit against the entry's, so the entry's stands for it. No
  // reader measures a diff from it: each says it holds no coverage.
  const refused = selection.withoutCoverage(coverage) ? undefined : refusal(selection.askCoverageFile, coverage, found.commit);
  if (refused !== undefined) {
    await rm(layer, { recursive: true, force: true });
    return await unread(refused);
  }

  // The runs record, beside the record under the name every reader looks for
  // it by, so a reader asks where each test last ran of the run that published
  // it. An entry without one leaves none there. A reader says what it read in
  // place of an answer the runs could not give, carried or not: when there are
  // none, when they are another commit's, and when they do not list a test.
  const runsFile = selection.commitRunsFile(coverage);
  let runs: string | undefined;
  if (found.runs === undefined) await rm(runsFile, { force: true });
  else if ((await keep(selection.writeCoverageBytes, runsFile, found.runs)) === undefined) runs = runsFile;

  // Named last, once every file it names is in place, so a seam that reads the
  // name finds them.
  const fetched = asked;
  await selection.writeFetchedMainline(cacheRoot, suite, { mainline: found.mainline, commit: found.commit, fetched });
  await rm(join(readRoot, MISSED), { force: true });
  // Each fetch of a new commit adds a directory here, and a fetch is where
  // they are made, so it is where they are taken back: once a day, by the rule
  // `planCachePrune` states, never the one just named.
  const pruned = selection.prunedLine(await pruneCacheWhenDue({ cacheRoot }, checkoutOwners(root, now)), CACHE_PRUNE_REASONS);
  return {
    suite,
    mainline: found.mainline,
    commit: found.commit,
    ...(found.distance !== undefined ? { distance: found.distance } : {}),
    coverage,
    ...(index !== undefined && casesUnread === undefined ? { cases: coverage } : {}),
    ...(casesUnread !== undefined ? { casesUnread } : {}),
    ...(runs === undefined ? {} : { runs }),
    fetched,
    ...(pruned === '' ? {} : { pruned }),
  };
}

/** The record fetched earlier, as a base, measured against this checkout now. */
async function earlier(
  place: Parameters<typeof distanceFrom>[0],
  root: string,
  last: LastFetched,
  why: NonNullable<MainlineRecord['earlier']>,
): Promise<MainlineRecord> {
  const distance = await distanceFrom(place, last.mainline, last.commit, root);
  const { keepsCases } = await import('@variance-authority/sense/test-selection');
  return {
    suite: last.suite,
    mainline: last.mainline,
    commit: last.commit,
    ...(distance !== undefined ? { distance } : {}),
    coverage: last.coverage,
    ...(keepsCases(last.coverage) ? { cases: last.coverage } : {}),
    ...(last.runs === undefined ? {} : { runs: last.runs }),
    fetched: last.fetched,
    earlier: why,
  };
}

/**
 * The line's answer that it gave no record, as `readRoot` keeps it, or
 * `undefined` when it keeps none that reads.
 */
export function readMissedMainline(readRoot: string): MissedMainline | undefined {
  let value: Partial<MissedMainline>;
  try {
    value = JSON.parse(readFileSync(join(readRoot, MISSED), 'utf8')) as Partial<MissedMainline>;
  } catch {
    return undefined;
  }
  const miss = value.miss as { kind?: unknown; detail?: unknown } | undefined;
  const reads = typeof miss?.kind === 'string' && (miss.detail === undefined || typeof miss.detail === 'string');
  if (typeof value.mainline !== 'string' || typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at)) || !reads) return undefined;
  const holds = Array.isArray(value.holds) && value.holds.every((name) => typeof name === 'string') ? value.holds : undefined;
  return { mainline: value.mainline, at: value.at, miss: value.miss as MainlineMiss, ...(holds === undefined ? {} : { holds }) };
}

/** Keep the line's answer that it gave no record under `readRoot`, where {@link readMissedMainline} reads it. */
export async function writeMissedMainline(readRoot: string, missed: MissedMainline): Promise<void> {
  await mkdir(readRoot, { recursive: true });
  await writeFile(join(readRoot, MISSED), `${JSON.stringify(missed)}\n`);
}

/** Best effort: a cache that cannot hold the note costs the next reader one more ask, and nothing else. */
async function noteMissed(readRoot: string, missed: MissedMainline): Promise<void> {
  try {
    await writeMissedMainline(readRoot, missed);
  } catch {
    // Nothing to do: see above.
  }
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
export function rootShare(config: RootConfig | undefined) {
  const value = config?.value['share'];
  if (config === undefined || value === undefined) return undefined;
  return parseShare(value, { source: config.file, baseDir: dirname(config.file) });
}

/**
 * The note that says the mainline's record was read: which mainline, which
 * commit, how far off, and where it is kept, and for the record fetched
 * earlier, when that was and why it stands. It is the first note, after the
 * reader's own verdict.
 */
export function mainlineRead(read: MainlineRecord): string {
  const why = read.earlier;
  const minutes = String(MAINLINE_REUSE_MS / 60_000);
  const when = why === undefined
    ? ''
    : 'reused' in why
      ? `, fetched at ${read.fetched} and reused for ${minutes} minutes`
      : 'refreshing' in why
        ? `, fetched at ${read.fetched}, more than ${minutes} minutes ago`
        : `, fetched at ${read.fetched}, because the mainline was not read now: ${describeMiss(why.unanswered)}` + answeredAt(why.asked);
  return `record of "${read.suite}": read from mainline ${read.mainline}, published at ${read.commit}${when}, ` +
    `${describeDistance(read.distance)}; kept at ${read.coverage}` +
    (read.casesUnread === undefined ? '' : `; ${read.casesUnread}`) +
    (read.pruned === undefined ? '' : `; ${read.pruned}`) +
    (why !== undefined && 'refreshing' in why ? `; ${refreshing(why.refreshing)}` : '');
}

/**
 * The note a reader gives when the mainline's record was not read and none was
 * fetched earlier. "None either" only when the share answered that it holds
 * none: a refusal or an unreachable share says nothing about what was
 * published. The line is named the way `variance share` names it, and a share
 * section that stopped the read says so instead, because then no line was
 * asked.
 */
export function mainlineMissed(missed: MainlineMissed): string {
  const said = describeMiss(missed.miss, missed.holds);
  if (missed.shareAsked === false) return `record of "${missed.suite}": the share was not asked; ${said}`;
  const opening = missed.miss.kind === 'absent' ? 'the share has none either' : "the mainline's was not read";
  const line = missed.mainline === undefined ? 'no mainline' : `mainline ${missed.mainline}`;
  return `record of "${missed.suite}": ${opening}; ${line}: ${said}${answeredAt(missed.asked)}`;
}

/** When the line's answer was given, for one given earlier within the window. */
function answeredAt(asked: string | undefined): string {
  return asked === undefined ? '' : `; that was the line's answer at ${asked}, which stands for ${String(MAINLINE_REUSE_MS / 60_000)} minutes`;
}

/**
 * The note a reader gives when it fell back to the primary checkout's record:
 * this worktree has recorded none, the mainline's was not read now and none was
 * fetched earlier on this machine. It names the file and why the mainline's is
 * not it.
 */
export function primaryRead(suite: string, file: string, missed: MainlineMissed | undefined): string {
  const why = missed === undefined ? '' : `; ${mainlineMissed(missed).slice(`record of "${suite}": `.length)}`;
  return `record of "${suite}": read from the primary checkout's, at ${file}, as the offline fallback: ` +
    `this worktree has recorded none, and no mainline record of it was fetched on this machine${why}`;
}

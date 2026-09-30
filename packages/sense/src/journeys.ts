/**
 * Layer-2 journeys: each recorded case walked once over the static call graph,
 * so a question about a file can say who reaches its recorded functions, where
 * they go, and which package flows pass through it.
 *
 * The walk is the addon's and is paid before anyone asks: `variance index`
 * prepares the journeys beside the source index, one file per suite, stamped
 * with the recording, the index and the runner's alias table they were made
 * from, and with the walk that made them. Preparing again with none of them
 * changed keeps the file. A question reads only that file, and a file whose
 * recording, index or walk moved since answers with why it cannot, never with
 * a stale route.
 */

// compass: variance-authority.reach.relations

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkoutListing, checkoutPath, type CheckoutListing } from './checkout-path.js';
import { native, nativeRefusal } from './native.js';
import type { NativeForksBetween, NativeJourneyEnd, NativeJourneyMap, NativeJourneyMapFile, NativePathsThrough, NativeJourneysAmong, NativeJourneysAnswer, NativeJourneysAsk, NativeJourneysCommit, NativeJourneysPrepared } from './native-journeys.js';
import type { SourceUpdate } from './published.js';
import { keptRunnerAliases, runnerConfigs, unlistedRunnerAliases, type RunnerAliases } from './runner-aliases.js';
import { sourceIndexPath } from './source-index.js';
import { nearestTestCoverage } from './test-selection/record-location.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { defaultInclude } from './test-selection/instrumented-modules.js';
import { declaredSuites } from './test-selection/suites.js';

export type {
  NativeForksBetween as ForksBetween,
  NativeJourneyBlock as JourneyBlock,
  NativeJourneyCase as JourneyCase,
  NativeJourneyEnd as JourneyEnd,
  NativeJourneyFork as JourneyFork,
  NativeJourneyFunction as JourneyFunction,
  NativeJourneyMap as JourneyMap,
  NativeJourneyMapBranch as JourneyMapBranch,
  NativeJourneyMapFunction as JourneyMapFunction,
  NativeJourneyMapPlace as JourneyMapPlace,
  NativeJourneyPath as JourneyPath,
  NativeJourneySide as JourneySide,
  NativePathsThrough as PathsThrough,
  NativeJourneysAmong as JourneysAmong,
  NativeJourneysAnswer as JourneysAnswer,
  NativeJourneysAsk as JourneysAsk,
  NativeJourneysBlock as JourneysBlock,
  NativeJourneysCall as JourneysCall,
  NativeJourneysFile as JourneysFile,
  NativeJourneysFlow as JourneysFlow,
  NativeJourneysFlows as JourneysFlows,
  NativeJourneysPlace as JourneysPlace,
  NativeJourneysPlaced as JourneysPlaced,
  NativeJourneysPrepared as JourneysPrepared,
  NativeJourneysRegion as JourneysRegion,
} from './native-journeys.js';

function entry<Name extends 'prepareJourneys' | 'journeysKept' | 'journeysFor' | 'journeysAmong' | 'pathsThrough' | 'forksBetween' | 'journeyMap'>(name: Name) {
  const scanner = native();
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(
      `journeys are walked by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`,
    );
  }
  return call.bind(scanner) as NonNullable<typeof call>;
}

/** Where one suite's journeys are kept beside the index at `index`. */
export function journeysPath(index: string, suite?: string): string {
  return suite === undefined ? `${index}.journeys` : `${index}.${encodeURIComponent(suite)}.journeys`;
}

/** One suite's recording, found the way every reader of one finds it: the case index beside the nearest snapshot. */
function recordings(root: string): readonly { readonly suite?: string; readonly recording?: string; readonly looked: string }[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const looked = `${nearestTestCoverage(root, { suite })}.cases.bin`;
    return { ...(suite === undefined ? {} : { suite }), ...(existsSync(looked) ? { recording: looked } : {}), looked };
  });
}

/** The commit a recording ran at, or why there is none: the walk then reads the tree as it is, and says so. */
function commitOf(coverage: string): NativeJourneysCommit {
  try {
    const commit = askCoverageFile(coverage, (read) => read.commit);
    return commit === undefined ? { unread: 'the recording names no commit' } : { commit };
  } catch (error) {
    return { unread: `the recording's commit did not read (${(error instanceof Error ? error.message : String(error)).split('\n')[0]})` };
  }
}

/**
 * What the checkout's owners say about `file`, for the answer given when the
 * recording keeps no row for it. The runner's default filter says whether a row
 * could be kept for it — a type declaration passes the filter's extension test
 * and has no function to run — `listing` is what git lists at the path in the
 * checkout, and git says whether it existed at the commit the recording names,
 * so a typo is not reported as a file, nor a file added since as one no test
 * loaded.
 */
function knownOf(root: string, file: string, recording: string, listing: CheckoutListing): NativeJourneyMapFile {
  const module = defaultInclude(resolve(root, file)) && !/\.d\.[cm]?ts$/.test(file);
  const now = 'unread' in listing ? {} : { listed: listing.file, directory: listing.directory, ignored: listing.ignored };
  // FIXME: the case index folds runs made at several commits, and the snapshot
  // names only the latest run's, so a row laid by an older run is judged against
  // a commit it was not made at. The commit each test file last ran at is in
  // commit-runs' `standing`; carry that instead.
  const at = commitOf(recording.slice(0, -'.cases.bin'.length));
  if (at.commit == null) return { module, ...now, ...(at.unread == null ? {} : { unread: at.unread }) };
  const then = gitLists(root, ['ls-tree', '--name-only', at.commit, '--', file]);
  return typeof then === 'boolean'
    ? { module, ...now, commit: at.commit, existed: then }
    : { module, ...now, commit: at.commit, unread: then.unread || `git could not list ${at.commit}` };
}

/** Whether a git listing names anything, or the first line git gave for not answering. */
function gitLists(root: string, args: readonly string[]): boolean | { unread: string } {
  try {
    const listed = execFileSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return listed.trim() !== '';
  } catch (error) {
    const said = error instanceof Error && 'stderr' in error ? String(error.stderr) : String(error);
    return { unread: said.trim().split('\n')[0] ?? '' };
  }
}

/** Where the runner's alias table is kept beside the index at `index`, shared by every suite. */
function runnerPath(index: string): string {
  return `${index}.runner-aliases.json`;
}

/** One suite's prepared journeys, or why none were prepared. */
export type PreparedJourneys =
  | { readonly suite?: string; readonly out: string; readonly prepared: NativeJourneysPrepared }
  | { readonly suite?: string; readonly out: string; readonly unprepared: string };

/**
 * Walk each suite's latest recording over the source index at `index` and keep
 * the journeys beside it, unless the kept ones were made from this recording,
 * this index, this runner table and this walk. `scanned` is the update that
 * published the index: its listing of the checkout is carried, and git is not
 * asked again; a scan that ran without one lists nothing, and says so.
 */
export async function prepareJourneys(
  root: string,
  index: string = sourceIndexPath(root),
  scanned?: Pick<SourceUpdate, 'listing'>,
): Promise<readonly PreparedJourneys[]> {
  const listing = scanned?.listing;
  const configs = scanned !== undefined && listing === undefined ? undefined : runnerConfigs(root, listing);
  // One table for every suite, read at most once, and not at all when it is kept.
  let table: RunnerAliases | undefined;
  const runner = async () =>
    (table ??= configs === undefined
      ? unlistedRunnerAliases(root, scanned !== undefined ? 'the scan had no listing of the checkout' : 'git could not list the checkout')
      : await keptRunnerAliases(root, configs, runnerPath(index)));
  const walk = listing?.prepareJourneys?.bind(listing) ?? entry('prepareJourneys');
  const prepared: PreparedJourneys[] = [];
  for (const { suite, recording, looked } of recordings(root)) {
    const named = suite === undefined ? {} : { suite };
    const out = journeysPath(index, suite);
    if (recording === undefined) {
      prepared.push({ ...named, out, unprepared: `nothing is recorded at ${looked}` });
      continue;
    }
    const aliases = await runner();
    const kept = entry('journeysKept')(index, recording, out, aliases.digest);
    if (kept !== null) {
      prepared.push({ ...named, out, prepared: kept });
      continue;
    }
    const at = commitOf(recording.slice(0, -'.cases.bin'.length));
    const made = walk(root, index, recording, at, out, JSON.stringify(aliases));
    prepared.push(made === null ? { ...named, out, unprepared: 'there is no source index' } : { ...named, out, prepared: made });
  }
  return prepared;
}

/** One suite's answer about the asked files, or why it has none. */
export interface JourneysAround {
  readonly suite?: string;
  readonly answer: NativeJourneysAnswer;
}

/**
 * What each recorded suite's prepared journeys say about `asks`, which are paths
 * from `root` with an optional line. A suite with no recording has no journeys
 * to speak of and is left out, so nothing recorded answers with no suite.
 */
export function journeysAround(root: string, asks: readonly NativeJourneysAsk[]): readonly JourneysAround[] {
  const index = sourceIndexPath(root);
  return recordings(root).flatMap(({ suite, recording }) => {
    if (recording === undefined) return [];
    const named = suite === undefined ? {} : { suite };
    return [{ ...named, answer: entry('journeysFor')(root, index, recording, journeysPath(index, suite), asks.map((ask) => ({ ...ask }))) }];
  });
}

/**
 * Every call the cases numbered `cases` placed, counted among them: a question
 * that kept some of a file's tests maps what those tests reach, not what every
 * test does. A case is numbered by its position in `suite`'s recording, the
 * numbering the recording's own reader hands out. `undefined` when the suite
 * has nothing recorded.
 */
export function journeysAmong(root: string, cases: readonly number[], suite?: string): NativeJourneysAmong | undefined {
  const index = sourceIndexPath(root);
  const found = recordings(root).find((recorded) => recorded.suite === suite);
  if (found?.recording === undefined) return undefined;
  return entry('journeysAmong')(index, found.recording, journeysPath(index, suite), [...cases]);
}

/**
 * Every path `suite`'s cases take through the innermost function recorded at
 * `file:line`, most cases first: a path is the regions written in the function
 * that its cases entered. The path more than half of them take is passage;
 * every other one is a purpose its smallest case tells. Read off the recording
 * alone, so nothing needs preparing. `undefined` when the suite has nothing
 * recorded.
 */
export function pathsThrough(root: string, at: NativeJourneyEnd, suite?: string): NativePathsThrough | undefined {
  const found = recordings(root).find((recorded) => recorded.suite === suite);
  if (found?.recording === undefined) return undefined;
  return entry('pathsThrough')(found.recording, at.file, at.line);
}

/**
 * How the function at `a` is connected to the one at `b` in `suite`'s cases:
 * the smallest journey that reached both, and on each side the journeys that
 * nearly did, with the regions that separate them from the ones that did.
 * `undefined` when the suite has nothing recorded.
 */
export function forksBetween(root: string, a: NativeJourneyEnd, b: NativeJourneyEnd, suite?: string): NativeForksBetween | undefined {
  const found = recordings(root).find((recorded) => recorded.suite === suite);
  if (found?.recording === undefined) return undefined;
  return entry('forksBetween')(found.recording, { ...a }, { ...b });
}

/**
 * The map of the code around `file` in `suite`'s cases, kept to the tests whose
 * file or name holds any of `terms`, ignoring case, or to every test that
 * entered the file when none is given. Each function of the file is its paths
 * among the kept tests; beyond it, what most of the suite enters is counted as
 * structure, what most kept tests enter is the spine, nearest first, and the
 * rest are branches, each told by its smallest test. `file` may be spelled
 * through `..` or from the file system's root; the map names it from the
 * checkout's root. `listing` is what git lists at the path, as
 * {@link checkoutListing} answers it, for a caller that has already asked.
 * `undefined` when the suite has nothing recorded.
 */
export function journeyMap(
  root: string,
  file: string,
  terms?: readonly string[],
  suite?: string,
  listing?: CheckoutListing,
): NativeJourneyMap | undefined {
  const found = recordings(root).find((recorded) => recorded.suite === suite);
  if (found?.recording === undefined) return undefined;
  return mapOf(root, file, terms, found.recording, listing).map;
}

/** One suite's map of the code around a file, or why the suite has none, with what the checkout said about the file. */
export interface SuiteJourneyMap {
  readonly suite?: string;
  readonly map: NativeJourneyMap;
  /** What git and the default filter said about the file; absent for a path outside the checkout. */
  readonly known?: NativeJourneyMapFile;
}

/**
 * {@link journeyMap} asked of every declared suite that has a recording, so a
 * task is not confined to the suite that happens to be unnamed. A suite with no
 * recording is left out; one whose recording does not hold the file answers
 * with the reason in `notRecorded`. Git is asked about the path once, unless
 * the caller carries its `listing`, and every suite reads that answer.
 */
export function journeyMaps(
  root: string,
  file: string,
  terms?: readonly string[],
  listing?: CheckoutListing,
): readonly SuiteJourneyMap[] {
  return recordings(root).flatMap(({ suite, recording }) => {
    if (recording === undefined) return [];
    const asked = checkoutPath(root, file);
    if ('path' in asked) listing ??= checkoutListing(root, asked.path);
    return [{ ...(suite === undefined ? {} : { suite }), ...mapOf(root, file, terms, recording, listing) }];
  });
}

/** One recording's map around `file`, with what the checkout said about it. */
function mapOf(
  root: string,
  file: string,
  terms: readonly string[] | undefined,
  recording: string,
  listing?: CheckoutListing,
): { readonly map: NativeJourneyMap; readonly known?: NativeJourneyMapFile } {
  const asked = checkoutPath(root, file);
  if ('outside' in asked) return { map: refused(file, asked.outside) };
  const known = knownOf(root, asked.path, recording, listing ?? checkoutListing(root, asked.path));
  return { map: entry('journeyMap')(recording, asked.path, terms === undefined ? null : [...terms], known), known };
}

/** A map with nothing on it, for a path the recording cannot hold. */
function refused(file: string, notRecorded: string): NativeJourneyMap {
  return { notRecorded, file, suite: 0, entered: 0, kept: 0, tests: [], functions: [], spine: [], branches: [], structure: 0 };
}

/**
 * Layer-2 journeys: each recorded case walked once over the static call graph,
 * so a question about a file can say who reaches its recorded functions, where
 * they go, and which package flows pass through it.
 *
 * The walk is the addon's and is paid before anyone asks: `variance index`
 * prepares the journeys beside the source index, one file per suite, stamped
 * with the recording and the index they were made from, and with the walk that
 * made them. Preparing again with none of them
 * changed keeps the file. A question reads only that file, and a file whose
 * recording, index or walk moved since answers with why it cannot, never with
 * a stale route.
 */

// compass: variance-authority.reach.relations

import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { checkoutListing, checkoutPath, existedAt, type CheckoutListing } from './checkout-path.js';
import { native, nativeRefusal } from './addon.js';
import type { NativeForksBetween, NativeJourneyEnd, NativeJourneyMap, NativeJourneyMapFile, NativePathsThrough, NativeJourneysAmong, NativeResonance, NativeJourneysAnswer, NativeJourneysAsk, NativeJourneysCommit, NativeJourneysPrepared, NativeLinesThen, NativeRanModule, NativeRanRegion, NativeTestComposition, NativeTestRan } from './native-journeys.js';
import type { SourceUpdate } from './published.js';
import { sourceIndexPath } from './source-index.js';
import { declaredTsconfig } from './typescript.js';
import { blocksChargedAt } from './test-selection/blocks-around.js';
import { nearestTestCoverage } from './test-selection/record-location.js';
import { keepsCases } from './test-selection/case-record.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { defaultInclude, insideRoot } from './test-selection/instrumented-modules.js';
import { declaredSuites } from './test-selection/suites.js';

function entry<Name extends 'prepareJourneys' | 'journeysKept' | 'journeysFor' | 'journeysAmong' | 'pathsThrough' | 'forksBetween' | 'journeyMap' | 'testComposition' | 'testRan' | 'linesThen' | 'resonance'>(name: Name) {
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

/** One suite's recording, found the way every reader of one finds it: the nearest snapshot, when it carries its cases. */
function recordings(root: string): readonly { readonly suite?: string; readonly recording?: string; readonly looked: string }[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const looked = nearestTestCoverage(root, { suite });
    return { ...(suite === undefined ? {} : { suite }), ...(keepsCases(looked) ? { recording: looked } : {}), looked };
  });
}

/**
 * The commit a recording ran at, or why there is none. A recording that names no
 * commit is an absence; one that does not read throws, since it is a fault.
 */
function commitOf(coverage: string): NativeJourneysCommit {
  const commit = askCoverageFile(coverage, (read) => read.commit);
  return commit === undefined ? { unread: 'the recording names no commit' } : { commit };
}

/** Why a recording that is there does not read. */
function unreadable(root: string, coverage: string, error: unknown): string {
  return `the recording at ${spelled(root, coverage)} does not read (${(error instanceof Error ? error.message : String(error)).split('\n')[0]})`;
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
  let at: NativeJourneysCommit;
  try {
    at = commitOf(recording);
  } catch (error) {
    return { module, ...now, unread: unreadable(root, recording, error) };
  }
  if (at.commit == null) return { module, ...now, ...(at.unread == null ? {} : { unread: at.unread }) };
  const then = existedAt(root, at.commit, file);
  return typeof then === 'boolean'
    ? { module, ...now, commit: at.commit, existed: then }
    : { module, ...now, commit: at.commit, unread: then.unread };
}

/**
 * `path` as the checkout names it, or as it is when it lies outside the
 * checkout: a recording kept in a shared cache is at no checkout path, and a
 * chain of `..` would name it from wherever the reader happens to stand.
 */
function spelled(root: string, path: string): string {
  return insideRoot(root, path) ? relative(root, path) : path;
}

/**
 * One suite's prepared journeys, or why none were prepared. `unprepared` is an
 * absence — nothing recorded, no commit named, no index — and `failed` a walk
 * that could not be made, git's refusal among them, which its caller reports as
 * a fault rather than as nothing to walk.
 */
export type PreparedJourneys =
  | { readonly suite?: string; readonly out: string; readonly prepared: NativeJourneysPrepared }
  | { readonly suite?: string; readonly out: string; readonly unprepared: string }
  | { readonly suite?: string; readonly out: string; readonly failed: string };

/**
 * Walk each suite's latest recording over the source index at `index` and keep
 * the journeys beside it, unless the kept ones were made from this recording,
 * this index and this walk. `scanned` is the update that
 * published the index: its listing of the checkout is carried, and git is not
 * asked again; a scan that ran without one lists nothing, and says so.
 */
export async function prepareJourneys(
  root: string,
  index: string = sourceIndexPath(root),
  scanned?: Pick<SourceUpdate, 'listing'>,
): Promise<readonly PreparedJourneys[]> {
  const listing = scanned?.listing;
  const walk = listing?.prepareJourneys?.bind(listing) ?? entry('prepareJourneys');
  // A call lands where the scan that built the index put it.
  const tsconfig = declaredTsconfig(root);
  const prepared: PreparedJourneys[] = [];
  for (const { suite, recording, looked } of recordings(root)) {
    const named = suite === undefined ? {} : { suite };
    const out = journeysPath(index, suite);
    if (recording === undefined) {
      // A file that is there and keeps no cases either reads, and holds none, or is a fault.
      let failed: string | undefined;
      if (existsSync(looked)) {
        try {
          commitOf(looked);
        } catch (error) {
          failed = unreadable(root, looked, error);
        }
      }
      prepared.push(failed === undefined ? { ...named, out, unprepared: `nothing is recorded at ${spelled(root, looked)}` } : { ...named, out, failed });
      continue;
    }
    const kept = entry('journeysKept')(index, recording, out);
    if (kept !== null) {
      prepared.push({ ...named, out, prepared: kept });
      continue;
    }
    // A recording's lines are coordinates in the tree it ran over, and git owns
    // that tree: without its commit, or with git unable to read it, there is no
    // walk, since the working tree is a different answer.
    let at: NativeJourneysCommit;
    try {
      at = commitOf(recording);
    } catch (error) {
      prepared.push({ ...named, out, failed: unreadable(root, recording, error) });
      continue;
    }
    if (at.unread != null) {
      prepared.push({ ...named, out, unprepared: at.unread });
      continue;
    }
    let made: NativeJourneysPrepared | null;
    try {
      made = walk(root, index, recording, at, out, tsconfig);
    } catch (error) {
      prepared.push({ ...named, out, failed: error instanceof Error ? error.message : String(error) });
      continue;
    }
    prepared.push(made === null ? { ...named, out, unprepared: 'there is no source index' } : { ...named, out, prepared: made });
  }
  return prepared;
}

/** The recording a reader of `suite` opens: with no name, the only one there is. */
function recordingOf(root: string, suite: string | undefined): ReturnType<typeof recordings>[number] | undefined {
  const all = recordings(root);
  return suite === undefined && all.length === 1 ? all[0] : all.find((recorded) => recorded.suite === suite);
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
  const found = recordingOf(root, suite);
  if (found?.recording === undefined) return undefined;
  return entry('journeysAmong')(index, found.recording, journeysPath(index, found.suite), [...cases]);
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
  const found = recordingOf(root, suite);
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
  const found = recordingOf(root, suite);
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
  const found = recordingOf(root, suite);
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

/** One suite's composition of a test, or why the suite cannot give one. */
export interface SuiteTestComposition {
  readonly suite?: string;
  readonly composition: NativeTestComposition;
}

/**
 * What the test declared in `file` is made of, asked of every declared suite
 * that has a recording: the smaller tests whose journeys sit inside its own,
 * the larger ones that hold it, and what no piece entered — its own layer, and
 * the paths of a piece's code only it takes. Structure, what more than half the
 * suite entered, is counted and taken away first. `name` chooses among several
 * tests of the file: the one named exactly that, or the one whose name holds
 * it, ignoring case. `file` may be spelled through `..` or from the file
 * system's root.
 */
export function testCompositions(root: string, file: string, name?: string): readonly SuiteTestComposition[] {
  return ofTest<NativeTestComposition>(root, file, uncomposed, (recording, path) => entry('testComposition')(recording, path, name ?? null)).map(
    ({ answer, ...named }) => ({ ...named, composition: answer }),
  );
}

/** What one suite's recording says one test ran, or why the suite cannot say. */
export interface SuiteTestRan {
  readonly suite?: string;
  readonly ran: NativeTestRan;
  /** The commit the recording ran at, whose lines its regions are spans of, when it names one. */
  readonly commit?: string;
}

/**
 * Which regions the test declared in `file` entered, and which it passed by,
 * in every module it entered, asked of every declared suite that has a
 * recording. `name` chooses among several tests of the file as it does for
 * {@link testCompositions}. A module the test entered nothing of is left out.
 */
export function testsRan(root: string, file: string, name?: string): readonly SuiteTestRan[] {
  return ofTest<Omit<SuiteTestRan, 'suite'>>(
    root,
    file,
    (notRecorded) => ({ ran: { notRecorded, suite: 0, modules: [] } }),
    (recording, path) => {
      const { commit } = commitOf(recording);
      return { ran: entry('testRan')(recording, path, name ?? null), ...(commit == null ? {} : { commit }) };
    },
  ).map(({ answer, ...named }) => ({ ...named, ...answer }));
}

/**
 * Where each of `lines` of `file`, as the checkout under `root` has it, stood
 * at `commit`: `null` for a line written since, which no recording made there
 * can have run.
 */
export function linesThen(root: string, commit: string, file: string, lines: readonly number[]): NativeLinesThen {
  return entry('linesThen')(root, commit, file, [...lines]);
}

/** How one suite's recording tells the declarations of a name apart at a line, or why it cannot. */
export interface SuiteResonance {
  readonly suite?: string;
  readonly resonance: NativeResonance;
  /** The declarations written since the recording ran, which it cannot have entered. */
  readonly since: readonly NativeJourneyEnd[];
}

/**
 * How each of `candidates`, the declarations of one name, resonates with the
 * line `at`, asked of every declared suite that has a recording: the cases that
 * entered each against the cases that ran the line. Each line is read where it
 * stood at the commit the recording ran at, one `linesThen` per file; a
 * candidate written since is set apart, and a line written since is refused.
 * A recording that names no commit, or a file whose lines cannot be placed at
 * it, is refused rather than scored where the lines stand now: a line read in
 * the wrong place scores another function's tests.
 */
export function resonance(root: string, at: NativeJourneyEnd, candidates: readonly NativeJourneyEnd[]): readonly SuiteResonance[] {
  const asked = checkoutPath(root, at.file);
  return recordings(root).flatMap(({ suite, recording }) => {
    if (recording === undefined) return [];
    const named = suite === undefined ? {} : { suite };
    const refuse = (notRecorded: string): SuiteResonance => ({ ...named, resonance: { notRecorded, cases: 0, resonant: [] }, since: [] });
    if ('outside' in asked) return [refuse(asked.outside)];
    const { commit, unread } = commitOf(recording);
    if (commit == null) return [refuse(unread ?? 'the recording names no commit')];
    const asking = [{ file: asked.path, line: at.line }, ...candidates];
    const lines: (number | null)[] = asking.map(({ line }) => line);
    for (const file of new Set(asking.map(({ file }) => file))) {
      const ats = asking.flatMap((end, at) => (end.file === file ? [at] : []));
      const placed = linesThen(root, commit, file, ats.map((at) => asking[at]!.line));
      if (placed.unplaced != null) return [refuse(placed.unplaced)];
      ats.forEach((at, nth) => { lines[at] = placed.lines[nth] ?? null; });
    }
    const [line, ...then] = lines;
    if (line == null) return [refuse(`${asked.path}:${at.line} was written since the recording ran`)];
    const placed = candidates.flatMap((candidate, at) => (then[at] == null ? [] : [{ at, end: { file: candidate.file, line: then[at]! } }]));
    const answer = entry('resonance')(recording, asked.path, line, placed.map(({ end }) => end));
    const resonant = answer.resonant.map((row) => {
      const { at } = placed[row.candidate]!;
      return { ...row, candidate: at, line: candidates[at]!.line };
    });
    const since = candidates.filter((_, at) => then[at] == null);
    return [{ ...named, resonance: { ...answer, resonant }, since }];
  });
}

/**
 * The outermost region of `module` holding `line` that the test did not enter,
 * or `undefined` when it ran the line: when an innermost region holding it was
 * entered, or none holds it. `partly` says the rest of the line ran.
 */
export function passedAt(module: NativeRanModule, line: number): { readonly region: NativeRanRegion; readonly partly: boolean } | undefined {
  const holding = module.regions.filter((region) => region.kind !== 'module' && region.source && region.line <= line && line <= region.end);
  const span = (region: NativeRanRegion): number => region.end - region.line;
  // Lines cannot nest two regions of one span: a function holds a branch of its
  // own on it, its one-line guard; two functions or two branches sit side by side.
  const holds = (outer: NativeRanRegion) => (inner: NativeRanRegion): boolean =>
    outer.line <= inner.line && inner.end <= outer.end &&
    (span(inner) < span(outer) || (outer.kind === 'function' && inner.kind !== 'function' && inner.function === outer.function));
  const innermost = holding.filter((region) => !holding.some(holds(region)));
  if (innermost.length === 0 || innermost.some((region) => region.entered)) return undefined;
  // `covering --line` charges a line that opens a region to the enclosing one
  // too: safe for choosing tests, wrong here, so it only says the rest ran.
  const charged = blocksChargedAt(
    module.regions.map((region) => ({ region, kind: region.kind, startLine: region.line, endLine: region.end, source: region.source })),
    line,
  );
  const region = holding
    .filter((region) => !region.entered)
    .reduce((best, region) => (span(region) > span(best) ? region : best));
  return { region, partly: charged.some(({ region }) => region.entered) };
}

/**
 * One answer per declared suite that has a recording, about the test file
 * `file`: read from the recording, or `refuse`d when `file` is outside the
 * checkout and no recording can hold it.
 */
function ofTest<T>(
  root: string,
  file: string,
  refuse: (notRecorded: string) => T,
  read: (recording: string, path: string) => T,
): readonly { readonly suite?: string; readonly answer: T }[] {
  const asked = checkoutPath(root, file);
  return recordings(root).flatMap(({ suite, recording }) => {
    if (recording === undefined) return [];
    const named = suite === undefined ? {} : { suite };
    return [{ ...named, answer: 'outside' in asked ? refuse(asked.outside) : read(recording, asked.path) }];
  });
}

/** A composition with nothing in it, for a test the recording cannot hold. */
function uncomposed(notRecorded: string): NativeTestComposition {
  return { notRecorded, suite: 0, structure: 0, alike: 0, pieces: [], wholes: [], explained: 0, own: [], reached: [] };
}

/** A map with nothing on it, for a path the recording cannot hold. */
function refused(file: string, notRecorded: string): NativeJourneyMap {
  return { notRecorded, file, suite: 0, entered: 0, kept: 0, tests: [], functions: [], spine: [], branches: [], structure: 0 };
}

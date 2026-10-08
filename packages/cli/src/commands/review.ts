// compass: variance-authority/runtime/attention
/**
 * What a change did, and what the run after it did about it.
 *
 * Every answer in this file has an owner elsewhere, and this file only joins
 * them for the reader who has to decide whether to merge. The diff is git's.
 * The kind of edit is the addon's reading of both texts. Which cases entered a
 * changed line is the case index's. How far a test sits from the file is the
 * file graph's. What a config change reaches is each test's declared
 * preconditions. What an install moved is the lockfile's. Nothing is measured
 * here that one of those already knows.
 *
 * It runs after the suite, so the record it reads already describes the change.
 * That fixes two coordinates. The change starts where the recording stood
 * before the first run at this commit, when git says it is an ancestor: the
 * runs record keeps that commit, since the snapshot names this one. And the line
 * numbers the record holds are the working tree's, so coverage reads the diff
 * reversed, while the reading of each edit reads it forward, against the text
 * it replaced.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  askCoverageFile,
  changedLines,
  coveringChange,
  coveringTestsInFile,
  readCommitRuns,
  readJourneyChange,
  testsGovernedBy,
  type CommitRuns,
  type ExecutionIndex,
  type ExecutionTest,
  type FileReading,
  type LineRange,
} from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import { OperatorError } from '../exit.js';
import { landingRecord, recordedSuite } from './suite-record.js';
import type { ParsedReview } from '../review-args.js';
import { motionAgainst, motionOfRuns, runsWrote, type CoveringMotion } from './covering-motion.js';
import { readExecutionFor, readExecutionIndex, recordedExecutionFile, replacedCases } from './execution-input.js';
import { installDiff, type DiffPoint, type InstallDiff } from './installed.js';
import { mainlineBase, mainlineMissed, type MainlineRecord } from './mainline-base.js';
import { reviewedCommit } from './review-head.js';
import { nearTests, regionsOf, removedText, treeLines } from './review-region.js';
import { packagesReached, type PackageReach } from './review-install.js';
import { diffPoint, diffSince } from './since.js';
import { runsBase } from './runs-base.js';
import { relationsFor } from './source-graph.js';
import type { ReviewCoverage } from './review-coverage.js';
/**
 * How a changed region was reached, first match wins.
 *
 * - `near`: a case from a test file that imports this file, or whose own
 *   source this file is, called into it.
 * - `far`: cases called into it, and every one of them came through another
 *   module.
 * - `unplaced`: cases called into it, none from a near test, and at least one
 *   from a test the import graph does not hold, so its distance was not measured.
 * - `loaded`: it ran only while its module was evaluated.
 * - `hole`: nothing entered it, and a case that could have stopped first.
 * - `unwalked`: nothing entered it, and every case that could have finished.
 * - `unknown`: the record cannot tell `hole` from `unwalked`.
 */
export type Reach = 'near' | 'far' | 'unplaced' | 'loaded' | 'hole' | 'unwalked' | 'unknown';

export const REACHES: readonly Reach[] = ['near', 'far', 'unplaced', 'loaded', 'hole', 'unwalked', 'unknown'];

export interface ReviewRegion {
  readonly kind: string;
  readonly name: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly reach: Reach;
  /**
   * `new` when the change wrote every line of words in it, `moved` when those
   * lines are also text the change removed, and `modified` otherwise. A
   * function renamed or declared again over its old body is `modified`.
   */
  readonly edit: 'new' | 'moved' | 'modified';
  /** The file the text of a `moved` region was removed from: its own, when it moved within the file. */
  readonly movedFrom?: string;
  /** How many cases called into it. */
  readonly cases: number;
  /**
   * How many of the cases that entered it ran a line of it the change wrote,
   * as `variance covering --line` names them for each such line. A case can
   * enter a function and take the branch the change left alone.
   */
  readonly changedLineCases: number;
  /** The test files those cases are declared in, in code-unit order. */
  readonly tests: readonly string[];
  /** Those cases by test file and title, in code-unit order: what a reader asks the count about. */
  readonly called: readonly ReviewCase[];
}

export interface ReviewCase {
  /** The id its producer gave it: two cases may share a file and a title, never an id. */
  readonly id: string;
  readonly file: string;
  /** The title with every `describe` it sits in, joined by ` > `. */
  readonly name: string;
  /** What it said it arranged, as `covering` reads it: empty is heard-nothing, absent is a record that did not listen. */
  readonly preconditions?: ExecutionTest['preconditions'];
}

export interface ReviewFile {
  readonly file: string;
  /** The reading of the edit. Absent for a file the module reader does not claim. */
  readonly verdict?: 'none' | 'bodies' | 'values' | 'load';
  /** Top-level bindings whose value moved, under `values`. */
  readonly names?: readonly string[];
  /** Why the edit could not be read, when it could not. A file the change created has no edit to read. */
  readonly unread?: string;
  /** The change created the file: there is no base text to read the edit against. */
  readonly created?: true;
  /** Whether the record holds a row for this file. Absent when coverage was not asked: an edit that changes nothing that runs. */
  readonly recorded?: boolean;
  readonly regions?: readonly ReviewRegion[];
  /** Case names the file declares now and did not, and the reverse. Absent when there is no base to compare with. */
  readonly cases?: { readonly added: readonly string[]; readonly removed: readonly string[] };
}
/** A changed file one or more tests declare as a precondition: before the reach of any import. */
export interface BeforeReach {
  readonly file: string;
  readonly tests: number;
}

export interface Review {
  /**
   * The checkout's commit and its parents, as git lists them, and `pull`, the
   * pull request's head when the CI event names one: on a pull request, CI
   * checks out the merge GitHub made, whose second parent is that head.
   * `dirty` when the tree had edits or new files on top of it, and `blob`,
   * where the host shows the files at it, only when it did not. Absent when
   * git could not say.
   */
  readonly head?: {
    readonly commit: string;
    readonly parents: readonly string[];
    readonly pull?: string;
    readonly dirty?: true;
    readonly blob?: string;
  };
  /** Optional per-suite evidence carried in the uploaded artifact. */
  readonly coverage?: readonly ReviewCoverage[];
  /** The suite whose changed-code evidence and freshness the summary describes. */
  readonly recordedSuite?: string;
  /** The commit the change is read from. */
  readonly from: string;
  /**
   * Whether the record holds this change. `ran` when every changed module it
   * recorded ran as the tree holds it now, so it says what the change did;
   * `before` when one ran as other text, so it names the cases that stood on
   * the changed lines — the ones the change might move — and code written
   * since has no row yet.
   */
  readonly record: 'ran' | 'before';
  /**
   * What `from` came from: `--since`, the commit the recording stood at before
   * these runs, or, when there was no recording before them, the record the
   * suite's mainline published — `from` is its commit, or that commit's merge
   * base with this checkout when it was published past it.
   */
  readonly base: 'since' | 'recording' | 'mainline';
  /** The mainline record the base was read from, when `base` is `mainline`. */
  readonly mainline?: {
    readonly name: string;
    readonly suite: string;
    readonly commit: string;
    /** Absent when this clone cannot count it. */
    readonly distance?: number;
    /** Where the record is kept in the cache. */
    readonly kept: string;
    /** Why the cases it published were not compared with, when it published cases that do not read. */
    readonly casesUnread?: string;
  };
  /** The runs recorded at this commit, when they listed themselves, less `test:since`'s `standing`. */
  readonly runs?: Omit<CommitRuns, 'standing'>;
  readonly files: readonly ReviewFile[];
  /** How many test files the snapshot holds, the scale `before` is read on. Absent with `before` when the snapshot could not be read. */
  readonly suite?: number;
  readonly before?: readonly BeforeReach[];
  /** Absent when there is no install to compare. */
  readonly beyond?: InstallDiff;
  /** Each package `beyond` names, followed to the files here that depend on it. Absent with `beyond`, or when it could not be compared. */
  readonly packages?: readonly PackageReach[];
  readonly motion?: CoveringMotion;
}

/** `motion: false` leaves out the cases moved against the base, for a reading made before CI that reports none. */
export async function review(request: ParsedReview, { motion: moves = true } = {}): Promise<Review> {
  const { root } = request;
  // TODO: a repository that declares several suites is read suite by suite when none is named, grouped by kind, with a suite that has no record reported as unrecorded, as `eachSuite` already reads them for `--coverage` and the handover; until then this reads one record and refuses to guess which.
  const recorded = await recordedSuite(root, request.suite);
  // The runs are always this checkout's own: a base it did not record, the mainline's or the
  // primary's, describes another change, and a record seeded from it (`runs: 0`) lists none.
  const own = await landingRecord(root, request.suite);
  const runs = await readCommitRuns(own).catch((error: unknown) => {
    const remedy = 'It records where this change starts: run the suite, which rewrites it; delete it first only if it is a directory';
    throw new OperatorError(`${error instanceof Error ? error.message : String(error)}. ${remedy}.`, { cause: error });
  }).then((listed) => (listed?.runs === 0 ? undefined : listed));
  const given = request.since ?? (await runsBase(root, runs, own));
  // Runs that name no start (`runsBase`), and no base named: a suite given to a
  // share starts from the record its mainline published, as a fresh CI checkout
  // always does (ADR-0084). With no run here at all, nothing is fetched.
  const shared = given === undefined && runs !== undefined ? await mainlineBase(root, recorded.declared) : undefined;
  const mainline = shared === undefined || 'miss' in shared ? undefined : shared;
  const ref = given ?? mainline?.commit;
  if (ref === undefined) {
    throw new OperatorError(
      (runs === undefined
        ? `no run has listed itself beside \`${own}\`, so nothing records where this change starts. ` +
            'Run the suite with `withTestSelection` first, or name the base with `--since <ref>`.'
        : `the runs at ${runs.commit?.slice(0, 12) ?? 'this checkout'} name no start ` +
            'they descend from, so nothing records where this change starts. Name the base with `--since <ref>`.') +
        (shared !== undefined && 'miss' in shared ? `\n${mainlineMissed(shared)}.` : ''),
      { kind: 'unrecorded' },
    );
  }
  const point = await diffPoint(ref);
  const forward = point === undefined ? undefined : await diffSince(ref, [], point.base);
  const backward = point === undefined ? undefined : await diffSince(ref, [], point.base, { reverse: true });
  if (point === undefined || forward === undefined || backward === undefined) {
    const whose = mainline === undefined ? '' : `, where mainline ${mainline.mainline} published its record of "${mainline.suite}",`;
    throw new OperatorError(
      `\`${ref}\`${whose} could not be read as a diff. Check the commit is in this checkout's history: ` +
        'a shallow clone has only the tip, so fetch the base, or check out every commit and no trees: ' +
        '`git clone --filter=tree:0`, or `fetch-depth: 0` with `filter: tree:0` on `actions/checkout`.',
    );
  }

  // The mainline's own case index is the base the cases are compared with,
  // unless one was named — and only when the diff starts at the commit it was
  // recorded at. A record published past the merge base holds the mainline's
  // later cases, and comparing with them would report its changes as this one's.
  const against = request.against ?? (mainline !== undefined && point.base === mainline.commit ? mainline.cases : undefined);

  const named = (file: string): string => relative(point.repository, resolve(process.cwd(), file));
  const relations = await relationsFor(root, ['.'], [], []);

  const changed = changedLines(forward);
  const reading = readJourneyChange(forward, textsAt(await prefetch(point, [...changed.keys()], named)), {
    root,
    relations,
  });
  const readings = new Map(reading.readings.map((read) => [read.file, read]));

  const from = await recordedExecutionFile(root, request.suite, recorded.file);
  const now = inTreeLines(changedLines(backward), root, readings);
  const { index } = await readExecutionFor(from, now);
  const covered = new Map(coveringChange(index, now, { relations }).map((file) => [file.file, file]));
  const full = await readExecutionIndex(from);
  const held = await baseIndex(against, from, request.against === undefined && against !== undefined ? mainline : undefined);
  // With no base named, the base is the layer the runs at this commit retired,
  // and it is theirs only for the test files a run at this commit wrote to the
  // case index; for any other file it holds an earlier commit's cases.
  const wrote = against === undefined && runs !== undefined ? await runsWrote(from, runs) : undefined;
  const comparable = (file: string): boolean => wrote === undefined || ('compared' in wrote && wrote.compared.has(file));
  const removed = removedText(forward);
  const near = await nearTests(recorded.file, [...covered.values()].filter((file) => file.recorded).map((file) => file.file), relations);

  const files: ReviewFile[] = [];
  for (const file of [...changed.keys()].sort()) {
    const read = readings.get(file);
    const change = covered.get(file);
    const ranges = now.get(file) ?? [];
    const created = await point.at(named(file)) === undefined && existsSync(resolve(root, file));
    // A file no run at this commit wrote has no base, so it has no answer either: absent, not every case added.
    const cases = comparable(file) ? casesMoved(file, held, full, created) : undefined;
    files.push({
      file,
      ...(created ? { created: true } : read === undefined ? {} : readingOf(read)),
      ...(change === undefined ? {} : {
        recorded: change.recorded,
        regions: regionsOf(change.regions, near.get(file), ranges, await treeLines(root, file), file, removed, coveringTestsInFile(index, file)),
      }),
      ...(cases === undefined ? {} : { cases }),
    });
  }

  const suite = await preconditionsOf(recorded.file, [...changed.keys()].map(named));
  const beyond = await installDiff(point, [...changed.keys()]);
  const packages = beyond === undefined || 'whole' in beyond ? undefined : packagesReached(beyond.packages, relations, full);
  const motion = !moves ? undefined : against !== undefined
    ? await motionAgainst(from, against, ref, root)
    : wrote === undefined
      ? undefined
      : await motionOfRuns(full, from, wrote, root, ref);

  const record = await ranAsTree(recorded.file, root, files.filter((file) => file.recorded === true).map((file) => file.file));
  const head = await reviewedCommit(point.repository);
  return {
    ...(head === undefined ? {} : { head }),
    from: point.base,
    record,
    base: request.since !== undefined ? 'since' : mainline === undefined ? 'recording' : 'mainline',
    ...(mainline === undefined ? {} : { mainline: mainlineOf(mainline) }),
    ...(runs === undefined ? {} : { runs: Object.fromEntries(Object.entries(runs).filter(([key]) => key !== 'standing')) as Omit<CommitRuns, 'standing'> }),
    files,
    ...(suite === undefined ? {} : {
      suite: suite.tests,
      before: beforeReach([...changed.keys()].map(named), suite.declared),
    }),
    ...(beyond === undefined ? {} : { beyond }),
    ...(packages === undefined ? {} : { packages }),
    ...(motion === undefined ? {} : { motion }),
  };
}

async function prefetch(
  point: DiffPoint,
  files: readonly string[],
  named: (file: string) => string,
): Promise<ReadonlyMap<string, string>> {
  const texts = new Map<string, string>();
  await Promise.all(files.map(async (file) => {
    const text = await point.at(named(file));
    if (text !== undefined) texts.set(file, text);
  }));
  return texts;
}

function textsAt(texts: ReadonlyMap<string, string>): (file: string) => string | undefined {
  return (file) => texts.get(file);
}
/**
 * The lines of the working tree the change wrote, in the record's names.
 *
 * A reversed diff charges the gap where the base had text the tree no longer
 * does; that text is gone, and nothing is left to cover, so the gap is not
 * asked about. A file the edit reading proved changes nothing that runs is not
 * asked about either, and neither is a file no longer in the tree.
 */
function inTreeLines(
  lines: ReadonlyMap<string, readonly LineRange[]>,
  root: string,
  readings: ReadonlyMap<string, FileReading>,
): ReadonlyMap<string, readonly LineRange[]> {
  const kept = new Map<string, readonly LineRange[]>();
  for (const [file, ranges] of lines) {
    if (readings.get(file)?.verdict === 'none' || !existsSync(resolve(root, file))) continue;
    const written = ranges.filter((range) => range.added === undefined);
    if (ranges.length > 0 && written.length === 0) continue;
    kept.set(file, written);
  }
  return kept;
}

function readingOf(read: FileReading): Pick<ReviewFile, 'verdict' | 'names' | 'unread'> {
  if (read.verdict === undefined) return { unread: read.unread };
  return read.names.length === 0 ? { verdict: read.verdict } : { verdict: read.verdict, names: read.names };
}

/**
 * Whether the record ran these modules as the tree holds them: the digest it
 * took of each module's text, against the text on disk. A change with no
 * recorded module ran nothing yet.
 */
async function ranAsTree(coverageFile: string, root: string, files: readonly string[]): Promise<'ran' | 'before'> {
  if (files.length === 0) return 'before';
  const recorded = await askCoverageFile(coverageFile, (coverage) => {
    const path = coverage.modulePath.all();
    const source = coverage.moduleSource.all();
    return new Map(Array.from(path, (held, module) => [coverage.string(held), coverage.string(source[module]!)]));
  });
  for (const file of files) {
    const text = await readFile(resolve(root, file), 'utf8').catch(() => undefined);
    if (text === undefined || recorded.get(file) !== digestString(text)) return 'before';
  }
  return 'ran';
}

/**
 * The case index the change is compared with: the one `--against` names or
 * the mainline published, or the cases the latest run replaced. Absent when
 * none was named and the run replaced none.
 */
async function baseIndex(
  against: string | undefined,
  from: string,
  mainline: MainlineRecord | undefined,
): Promise<ExecutionIndex | undefined> {
  if (against === undefined) return replacedCases(from);
  try {
    return await readExecutionIndex(against);
  } catch (error) {
    const named = mainline === undefined
      ? `\`--against ${against}\``
      : `the cases mainline ${mainline.mainline} published with its record of "${mainline.suite}", kept at ${against},`;
    throw new OperatorError(`${named} could not be read (${error instanceof Error ? error.message : String(error)}).`);
  }
}

/**
 * Case names a test file declares now and did not before, and the reverse.
 *
 * Only for a file the base holds cases for, or a file the change created. A
 * file the base never ran is not a file whose every case is new.
 */
function casesMoved(
  file: string,
  held: ExecutionIndex | undefined,
  now: ExecutionIndex,
  created: boolean,
): ReviewFile['cases'] | undefined {
  const after = new Set(now.tests.filter((test) => test.file === file).map((test) => test.name));
  const before = new Set(held?.tests.filter((test) => test.file === file).map((test) => test.name) ?? []);
  if (before.size === 0 && !created) return undefined;
  if (before.size === 0 && after.size === 0) return undefined;
  return {
    added: [...after].filter((name) => !before.has(name)).sort(),
    removed: [...before].filter((name) => !after.has(name)).sort(),
  };
}

/**
 * How many test files the snapshot holds, and how many of them declare each
 * changed file as a precondition. The snapshot's own lookup answers it; a test
 * that declares its own source is not counted, since that is the test itself.
 */
async function preconditionsOf(
  coverageFile: string,
  changed: readonly string[],
): Promise<{ readonly tests: number; readonly declared: ReadonlyMap<string, number> } | undefined> {
  try {
    return await askCoverageFile(coverageFile, (coverage) => {
      const declared = new Map<string, number>();
      for (const [test, names] of testsGovernedBy(coverage, changed).tests) {
        const own = coverage.string(coverage.testPath.at(test));
        for (const name of names) if (name !== own) declared.set(name, (declared.get(name) ?? 0) + 1);
      }
      return { tests: coverage.testPath.length, declared };
    });
  } catch {
    return undefined;
  }
}

function beforeReach(changed: readonly string[], declared: ReadonlyMap<string, number>): readonly BeforeReach[] {
  return changed
    .filter((file) => declared.has(file))
    .map((file) => ({ file, tests: declared.get(file)! }))
    .sort((left, right) => right.tests - left.tests || (left.file < right.file ? -1 : 1));
}

/** What a review says about the mainline record it started from: enough to name it, and where it is kept. */
function mainlineOf(read: MainlineRecord): NonNullable<Review['mainline']> {
  return {
    name: read.mainline,
    suite: read.suite,
    commit: read.commit,
    ...(read.distance === undefined ? {} : { distance: read.distance }),
    kept: read.coverage,
    ...(read.casesUnread === undefined ? {} : { casesUnread: read.casesUnread }),
  };
}

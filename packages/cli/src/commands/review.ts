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
import { relative, resolve } from 'node:path';
import {
  changedLines,
  readCommitRuns,
  readJourneyChange,
  whatLanded,
  type CasePrecondition,
  type CommitRuns,
  type ExecutionIndex,
  type FileReading,
  type LineRange,
  type Misuse,
  type WhatLanded,
} from '@variance-authority/sense/test-selection';
import { affectedBy, type EdgeKind } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import { landingRecord, recordedSuite } from './suite-record.js';
import type { ParsedReview } from '../review-args.js';
import { motionAgainst, motionOfRuns, runsWrote, type CoveringMotion } from './covering-motion.js';
import { readExecutionFor, readExecutionIndex, recordedExecutionFile, replacedCases } from './execution-input.js';
import { heldAsPrecondition, type HeldAsPrecondition } from './held-as-precondition.js';
import { installDiff, type DiffPoint, type InstallDiff } from './installed.js';
import { mainlineBase, mainlineMissed, type MainlineRecord } from './mainline-base.js';
import { reviewedCommit } from './review-head.js';
import { everySuiteRegions } from './review-suites.js';
import { ranAsTree, recordedRegions, removedText } from './review-region.js';
import { packagesReached, type PackageReach } from './review-install.js';
import { changedPackagesOf } from './review-changed-packages.js';
import { diffPoint, diffSince } from './since.js';
import { probesGap, probesNote } from './probes-gap.js';
import { runsBase } from './runs-base.js';
import { indexUpToCheckout, sourceGraphFor } from './source-graph.js';
import type { ReviewCoverage } from './review-coverage.js';
/**
 * The edges a changed package's importers are walked through. Who imports the changed code is a question about
 * source, so a package importing only a type reads the change too; one that only reads the file, as a stylesheet or a
 * `/// <depends>` does, imports nothing.
 */
const IMPORT_EDGES: readonly EdgeKind[] = ['imports', 'reexports', 'dynamic', 'type'];

/**
 * How a changed region was reached, first match wins: `near` when a case from a
 * test file importing the file, or whose source it is, called into it, `far`
 * when every one came through another module, and `unplaced` when one came
 * from a test the import graph does not hold. The rest are the record's own
 * `Reach` (`@variance-authority/sense/test-selection`) of a region no case
 * called into.
 */
export type Reach = 'near' | 'far' | 'unplaced' | 'loaded' | 'overwritten' | 'hole' | 'unwalked' | 'unknown';

export const REACHES: readonly Reach[] = ['near', 'far', 'unplaced', 'loaded', 'overwritten', 'hole', 'unwalked', 'unknown'];

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
  /** Those cases by test file, title and id, in code-unit order: what a reader asks the count about. */
  readonly called: readonly ReviewCase[];
}

export interface ReviewCase {
  /** The id its producer gave it: two cases may share a file and a title, never an id. */
  readonly id: string;
  readonly file: string;
  /** The title with every `describe` it sits in, joined by ` > `. */
  readonly name: string;
  /** What it said it arranged, as `covering` reads it: empty is heard-nothing, absent is a record that did not listen. */
  readonly preconditions?: readonly CasePrecondition[];
  /** What the code it ran read, as `covering` reads it: empty is read-nothing, absent is a record that did not listen. */
  readonly reads?: readonly CasePrecondition[];
  /** Each `varianceBreadcrumb` call in it that made no `dimension:key`, empty where none did; absent where the run did not listen to reads. */
  readonly misused?: readonly Misuse[];
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
  /** The source index read the file: it holds code, in a language the module reader may not claim. */
  readonly indexed?: true;
  /** The record holds cases declared in the file: a test file it ran, which no case enters as a module. */
  readonly holdsCases?: true;
  /** Whether the record holds a row for this file. Absent when coverage was not asked: an edit that changes nothing that runs. */
  readonly recorded?: boolean;
  readonly regions?: readonly ReviewRegion[];
  /** Case names the file declares now and did not, and the reverse. Absent when there is no base to compare with. */
  readonly cases?: { readonly added: readonly string[]; readonly removed: readonly string[] };
}
/** One package holding changed functions: what `review` calls where the change lands. */
export interface ChangedPackage {
  /** The manifest's `name`, or its directory when it declares none. */
  readonly package: string;
  /** The directory of its manifest inside the root; `.` for the root, and for files under no manifest. */
  readonly path: string;
  /** Its changed functions, a branch counted under the function holding it. */
  readonly functions: number;
  /**
   * Those functions by their own region's reach, the mark the table of what ran gives each; code outside any function
   * by its worst region's.
   */
  readonly reaches: Partial<Record<Reach, number>>;
  /** How many of those functions hold changed code no case ran: the ones no case entered, and the ones a case entered that left a branch in them unrun. */
  readonly uncovered: number;
  /** How many of the rest hold changed code no case is known to have run, a case having run it in a text an edit wrote over; absent, not none, from a review.json written by a build that did not count them. */
  readonly overwritten?: number;
  /** Whether a test file in its own directory entered them. */
  readonly own: boolean;
  /** The other packages whose test files entered them, by name, in code-unit order. */
  readonly tests: readonly string[];
  /**
   * How many other packages hold a file that imports its changed files, through any number of imports, a type-only
   * import included. A count, not the names: next to a hub, the names run into the thousands for every package the
   * change touches. Absent when the import graph holds none of its changed files.
   */
  readonly importers?: number;
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
  /** The suite whose runs and freshness the summary describes. Under `--coverage` the changed regions are every declared suite's. */
  readonly recordedSuite?: string;
  /** The commit the change is read from. */
  readonly from: string;
  /**
   * Whether the record holds this change. `ran` when every changed module it
   * recorded ran as the tree holds it now, so it says what the change did;
   * `before` when one ran as other text, or as a text not known
   * ({@link Review.notUpdated}), so it names the cases that stood on
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
  /** The runs recorded at this commit, when they listed themselves. */
  readonly runs?: ReviewRuns;
  readonly files: readonly ReviewFile[];
  /** The packages holding changed functions, by directory. Absent when no changed function was located. */
  readonly changedPackages?: readonly ChangedPackage[];
  /** How many test files the snapshot holds, the scale `before` is read on. Absent with `before` when the snapshot could not be read. */
  readonly suite?: number;
  readonly before?: readonly BeforeReach[];
  /** Absent when there is no install to compare. */
  readonly beyond?: InstallDiff;
  /** Each package `beyond` names, followed to the files here that depend on it. Absent with `beyond`, or when it could not be compared. */
  readonly packages?: readonly PackageReach[];
  readonly motion?: CoveringMotion;
  /** What a record cut under probes this build does not place leaves open, said beside the answer read from it (`probes-gap.ts`). */
  readonly probes?: string;
  /** Why no case is said to have moved, when the runs record could not be read and `--since` named the base. */
  readonly runsUnread?: string;
  /** Why which text the record ran over is not known, when the source index could not be brought up to the checkout to name the tree's. */
  readonly notUpdated?: string;
}

/** The runs at this commit as a review reports them: where and when they ran, how many, and what their landings say together. */
export interface ReviewRuns extends Pick<CommitRuns, 'commit' | 'over' | 'latest' | 'runs'>, WhatLanded {}

/** `motion: false` leaves out the cases moved against the base, for a reading made before CI that reports none. */
export async function review(request: ParsedReview, { motion: moves = true } = {}): Promise<Review> {
  const { root } = request;
  // TODO: a repository that declares several suites is read suite by suite when none is named, grouped by kind, with a suite that has no record reported as unrecorded, as `eachSuite` already reads them for `--coverage` and the handover; `--coverage` joins every suite's changed regions, but the base, the runs and the freshness are still the named suite's, and with none named this refuses to guess which.
  const recorded = await recordedSuite(root, request.suite);
  // The runs are always this checkout's own: a base it did not record, the mainline's or the
  // primary's, describes another change, and a record seeded from it (`runs: 0`) lists none.
  const own = await landingRecord(root, request.suite);
  // A runs record that cannot be read says neither where the change starts nor
  // which test files the runs wrote. A named base answers the first; the second
  // stays open, so no case is said to have moved, and the answer says why.
  let unread: string | undefined;
  const runs = await readCommitRuns(own).catch((error: unknown) => {
    if (request.since !== undefined) {
      unread = error instanceof Error ? error.message : String(error);
      return undefined;
    }
    const why = 'It records where this change starts, and a review that read it as absent would start from a guess';
    throw new OperatorError(`${error instanceof Error ? error.message : String(error)}. ${why}. Name the base with \`--since <ref>\`.`, { cause: error });
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
            'Name the base with `--since <ref>`.'
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
  // Which text each changed file holds now is the index's name for it, so the index is brought up to the checkout first.
  const notUpdated = await indexUpToCheckout(root);
  // One it could not names the tree as the last update found it, so it names no text the record could have run as the tree.
  const graph = await sourceGraphFor(root, ['.']);
  const { relations, sources } = graph;
  const names = notUpdated === undefined ? graph.names : new Map<string, string>();
  const changed = changedLines(forward);
  const reading = readJourneyChange(forward, textsAt(await prefetch(point, [...changed.keys()], named)), {
    root,
    relations,
  });
  const readings = new Map(reading.readings.map((read) => [read.file, read]));

  const from = await recordedExecutionFile(root, request.suite, recorded.file);
  const now = inTreeLines(changedLines(backward), root, readings);
  const removed = removedText(forward);
  const { index: changedCases } = await readExecutionFor(from, now);
  const suiteRegions = await recordedRegions(from, changedCases, now, relations, root, removed);
  const covered = request.coverage === true
    ? await everySuiteRegions(root, { ...(recorded.declared === undefined ? {} : { suite: recorded.declared.name }), record: from, index: changedCases }, suiteRegions, now, relations, removed, names)
    : suiteRegions;
  const full = await readExecutionIndex(from);
  const held = await baseIndex(against, from, request.against === undefined && against !== undefined ? mainline : undefined);
  // With no base named, the base is the layer the runs at this commit retired,
  // and it is theirs only for the test files a run at this commit wrote to the
  // case index; for any other file it holds an earlier commit's cases.
  const wrote = against === undefined && runs !== undefined ? await runsWrote(from, runs) : undefined;
  const comparable = (file: string): boolean => against !== undefined || (unread === undefined && (wrote === undefined || ('compared' in wrote && wrote.compared.has(file))));

  const tested = new Set(full.tests.map((test) => test.file));
  const files: ReviewFile[] = [];
  for (const file of [...changed.keys()].sort()) {
    const read = readings.get(file);
    const change = covered.get(file);
    const created = await point.at(named(file)) === undefined && existsSync(resolve(root, file));
    // A file no run at this commit wrote has no base, so it has no answer either: absent, not every case added.
    const cases = comparable(file) ? casesMoved(file, held, full, created) : undefined;
    files.push({
      file,
      ...(created ? { created: true } : read === undefined ? {} : readingOf(read)),
      ...(sources.has(file) ? { indexed: true } : {}),
      ...(tested.has(file) ? { holdsCases: true } : {}),
      ...(change === undefined ? {} : { recorded: change.recorded, regions: change.regions }),
      ...(cases === undefined ? {} : { cases }),
    });
  }

  const changedPackages = changedPackagesOf(root, files, (seeds) => {
    const reach = affectedBy(relations, seeds, { through: IMPORT_EDGES });
    return reach.missing.length === seeds.length ? undefined : reach.files;
  });
  const suite = heldAsPrecondition(recorded.file, [...changed.keys()].map(named));
  const beyond = await installDiff(point, [...changed.keys()]);
  const packages = beyond === undefined || 'whole' in beyond ? undefined : packagesReached(beyond.packages, relations, full);
  const motion = !moves ? undefined : against !== undefined
    ? await motionAgainst(from, against, ref, root)
    : wrote === undefined || unread !== undefined
      ? undefined
      : await motionOfRuns(full, from, wrote, root, ref);

  // The named suite's freshness: a module another suite recorded says nothing about whether this one ran.
  const measured = [...suiteRegions].filter(([, answer]) => answer.recorded).map(([file]) => file);
  // A change with no recorded module ran nothing yet.
  const record = measured.length > 0 && ranAsTree(recorded.file, measured, changedCases, names).size === measured.length ? 'ran' : 'before';
  const head = await reviewedCommit(point.repository);
  const gap = await probesGap(from, root, request.suite);
  return {
    ...(head === undefined ? {} : { head }),
    from: point.base,
    record,
    base: request.since !== undefined ? 'since' : mainline === undefined ? 'recording' : 'mainline',
    ...(mainline === undefined ? {} : { mainline: mainlineOf(mainline) }),
    ...(runs === undefined ? {} : { runs: reviewRuns(runs) }),
    files,
    ...(changedPackages.length === 0 ? {} : { changedPackages }),
    ...(suite === undefined ? {} : {
      suite: suite.tests,
      before: beforeReach([...changed.keys()].map(named), suite.of),
    }),
    ...(beyond === undefined ? {} : { beyond }),
    ...(packages === undefined ? {} : { packages }),
    ...(motion === undefined ? {} : { motion }),
    ...(gap === undefined ? {} : { probes: probesNote(gap) }),
    ...(unread === undefined ? {} : { runsUnread: runsUnreadNote(unread, against !== undefined) }),
    ...(notUpdated === undefined ? {} : { notUpdated: notUpdatedNote(notUpdated) }),
  };
}

/** `runs` as a review reports it: no `standing`, and its landings as what they say together. */
function reviewRuns({ standing: _standing, landings, ...runs }: CommitRuns): ReviewRuns {
  return { ...runs, ...whatLanded(landings) };
}

/** What a source index that could not be brought up to the checkout leaves open beside the answer. */
function notUpdatedNote(reason: string): string {
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1).replace(/\.$/u, '')}, so which text the record ran over is not known, and its rows are read as the cases that stood on the changed lines.`;
}

/** What an unreadable runs record leaves open beside an answer from a named base. */
function runsUnreadNote(message: string, compared: boolean): string {
  return `${message.charAt(0).toUpperCase()}${message.slice(1).replace(/\.$/u, '')}, so which test files the runs wrote cannot be said, and ${
    compared ? 'the cases are compared with the named base\'s alone' : 'no case is said to have moved'
  }.`;
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

/** The changed files test files hold as a precondition, each with how many hold it, the most held first. */
function beforeReach(changed: readonly string[], held: HeldAsPrecondition['of']): readonly BeforeReach[] {
  return changed
    .filter((file) => held.has(file))
    .map((file) => ({ file, tests: held.get(file)!.length }))
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

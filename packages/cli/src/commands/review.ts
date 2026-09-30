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
 * before the first run at this commit: {@link readCommitRuns} keeps that
 * commit, because the snapshot itself now names this one. And the line numbers
 * the record holds are the working tree's, so coverage reads the diff reversed,
 * while the reading of each edit reads it forward, against the text it
 * replaced.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  askCoverageFile,
  caseLayerFiles,
  changedLines,
  coveringChange,
  distanceToSource,
  readCommitRuns,
  readJourneyChange,
  testsGovernedBy,
  type CommitRuns,
  type CoveringRegion,
  type ExecutionIndex,
  type FileReading,
  type LineRange,
} from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';
import type { Relations } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import { landingRecord, recordedSuite } from './suite-record.js';
import type { ParsedReview } from '../review-args.js';
import { regionState } from './covering-frame.js';
import { motionAgainst, motionOfRuns, runsWrote, type CoveringMotion } from './covering-motion.js';
import { readExecutionFor, readExecutionIndex, recordedExecutionFile } from './execution-input.js';
import { installDiff, type DiffPoint, type InstallDiff } from './installed.js';
import { mainlineBase, mainlineMissed, type MainlineRecord } from './mainline-base.js';
import { diffPoint, diffSince } from './since.js';
import { relationsFor } from './source-graph.js';

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
   * The line it starts on is new or changed: a new function, or one declared
   * again. Its first line, not every line, because a diff pairs a new closing
   * brace with an old one as readily as with nothing.
   */
  readonly written: boolean;
  /** How many cases called into it. */
  readonly cases: number;
  /** The test files those cases are declared in, in code-unit order. */
  readonly tests: readonly string[];
  /** Those cases by test file and title, in code-unit order: what a reader asks the count about. */
  readonly called: readonly ReviewCase[];
}

export interface ReviewCase {
  readonly file: string;
  /** The title with every `describe` it sits in, joined by ` > `. */
  readonly name: string;
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
  /** The runs recorded at this commit, when they listed themselves. */
  readonly runs?: CommitRuns;
  readonly files: readonly ReviewFile[];
  /** How many test files the snapshot holds, the scale `before` is read on. Absent with `before` when the snapshot could not be read. */
  readonly suite?: number;
  readonly before?: readonly BeforeReach[];
  /** Absent when there is no install to compare. */
  readonly beyond?: InstallDiff;
  readonly motion?: CoveringMotion;
}

export async function review(request: ParsedReview): Promise<Review> {
  const { root } = request;
  // TODO: a repository that declares several suites is read suite by suite when none is named, grouped by kind, with a suite that has no record reported as unrecorded; until then this reads one record and refuses to guess which.
  const recorded = await recordedSuite(root, request.suite);
  const coverageFile = recorded.file;
  // The runs are this checkout's: where its change starts and which files it
  // ran. A worktree that has not run reads the primary checkout's record, and
  // the primary's runs beside it describe the primary's change, not this one.
  const own = await landingRecord(root, request.suite);
  const runs = await readCommitRuns(own);
  const given = request.since ?? runs?.over;
  // Runs that were laid over no recording, and no base named: a suite given to
  // a share starts from the record its mainline published, which is the state
  // a fresh CI checkout is always in (spec 0074, item 5). With no run here at
  // all there is nothing to review, and nothing is fetched.
  const shared = given === undefined && runs !== undefined ? await mainlineBase(root, recorded.declared) : undefined;
  const mainline = shared === undefined || 'miss' in shared ? undefined : shared;
  const ref = given ?? mainline?.commit;
  if (ref === undefined) {
    throw new OperatorError(
      (runs === undefined
        ? `no run has listed itself beside \`${own}\`, so nothing says where this change starts. ` +
            'Run the suite with `withTestSelection` first, or name the base with `--since <ref>`.'
        : `the runs at ${runs.commit?.slice(0, 12) ?? 'this checkout'} were not laid over a recording of ` +
            'the same instrumentation, so nothing says where this change starts. Name the base with `--since <ref>`.') +
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
        'a shallow clone holds only the tip, so fetch the base, or check out with `fetch-depth: 0`.',
    );
  }

  // The mainline's own case index is the base the cases are compared with,
  // unless one was named — and only when the diff starts at the commit it was
  // recorded at. A record published past the merge base holds the mainline's
  // later cases, and comparing with them would report its changes as this one's.
  const against = request.against ?? (mainline !== undefined && point.base === mainline.commit ? mainline.cases : undefined);

  const here = process.cwd();
  const named = (file: string): string => relative(point.repository, resolve(here, file));
  const relations = await relationsFor(root, ['.'], [], [], {
    why: 'a review reads which tests import each changed file, and which cases ran against a mock of it',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  });

  const changed = changedLines(forward);
  const reading = readJourneyChange(forward, textsAt(await prefetch(point, [...changed.keys()], named)), {
    root,
    relations,
  });
  const readings = new Map(reading.readings.map((read) => [read.file, read]));

  const from = await recordedExecutionFile(root, request.suite, coverageFile);
  const now = inTreeLines(changedLines(backward), root, readings);
  const { index } = await readExecutionFor(from, now);
  const covered = new Map(
    coveringChange(index, now, { relations }).map((file) => [file.file, file]),
  );
  const full = await readExecutionIndex(from);
  const held = await baseIndex(against, from, request.against === undefined && against !== undefined ? mainline : undefined);
  // With no base named, the base is the layer the runs at this commit retired,
  // and it is theirs only for the test files a run at this commit wrote to the
  // case index; for any other file it holds an earlier commit's cases.
  const wrote = against === undefined && runs !== undefined ? await runsWrote(from, runs) : undefined;
  const comparable = (file: string): boolean => wrote === undefined || ('compared' in wrote && wrote.compared.has(file));
  const near = await nearTests(coverageFile, [...covered.values()].filter((file) => file.recorded).map((file) => file.file), relations);

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
        regions: change.regions.map((region) => regionOf(region, near.get(file), ranges)),
      }),
      ...(cases === undefined ? {} : { cases }),
    });
  }

  const suite = await preconditionsOf(coverageFile, [...changed.keys()].map(named));
  const beyond = await installDiff(point, [...changed.keys()]);
  const motion = against !== undefined
    ? await motionAgainst(from, against, ref, root)
    : wrote === undefined
      ? undefined
      : await motionOfRuns(full, from, wrote, root, ref);

  const record = await ranAsTree(coverageFile, root, files.filter((file) => file.recorded === true).map((file) => file.file));
  return {
    from: point.base,
    record,
    base: request.since !== undefined ? 'since' : mainline === undefined ? 'recording' : 'mainline',
    ...(mainline === undefined ? {} : { mainline: mainlineOf(mainline) }),
    ...(runs === undefined ? {} : { runs }),
    files,
    ...(suite === undefined ? {} : {
      suite: suite.tests,
      before: beforeReach([...changed.keys()].map(named), suite.declared),
    }),
    ...(beyond === undefined ? {} : { beyond }),
    ...(motion === undefined ? {} : { motion }),
  };
}

/** The text each changed module had at the base, read before the synchronous reader asks for it. */
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

function regionOf(
  region: CoveringRegion,
  bearings: Bearings | undefined,
  ranges: readonly LineRange[],
): ReviewRegion {
  const called = region.tests.filter((test) => test.loaded !== true);
  const state = regionState(region);
  const reach: Reach = called.some((test) => bearings?.near.has(test.file) === true)
    ? 'near'
    : called.some((test) => bearings === undefined || bearings.unmeasured.has(test.file))
      ? 'unplaced'
      : called.length > 0
        ? 'far'
        : state === 'loaded' || state === 'hole' || state === 'unwalked'
          ? state
          : 'unknown';
  return {
    kind: region.kind,
    name: region.name,
    startLine: region.startLine,
    endLine: region.endLine,
    reach,
    written: ranges.some((range) => range.start <= region.startLine && region.startLine <= range.end),
    cases: called.length,
    tests: [...new Set(called.map((test) => test.file))].sort(),
    called: called
      .map((test) => ({ file: test.file, name: test.name }))
      .sort((left, right) => order(left.file, right.file) || order(left.name, right.name)),
  };
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

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The test files near a changed module, and those whose distance to it was not measured. */
interface Bearings {
  readonly near: ReadonlySet<string>;
  readonly unmeasured: ReadonlySet<string>;
}

/**
 * For each changed module, the test files one import away from it or declaring
 * it: the tests a reviewer expects to exercise it. Measured by the file graph
 * over what each test executed, not by where the files sit. A test the graph
 * does not hold, such as one written after the source index was published, is
 * kept apart, so a region only it covered is not called far.
 */
async function nearTests(
  coverageFile: string,
  files: readonly string[],
  relations: Relations,
): Promise<ReadonlyMap<string, Bearings>> {
  const bearings = new Map<string, Bearings>();
  for (const file of files) {
    const { distances } = await distanceToSource(coverageFile, { file }, { relations });
    const tests = (kept: (bearing: string) => boolean): ReadonlySet<string> =>
      new Set(distances.filter((distance) => kept(distance.bearing)).map((distance) => distance.test));
    bearings.set(file, {
      near: tests((bearing) => bearing === 'direct' || bearing === 'precondition'),
      unmeasured: tests((bearing) => bearing === 'unmeasured'),
    });
  }
  return bearings;
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
  try {
    return await readExecutionIndex(against ?? caseLayerFiles(from).before);
  } catch (error) {
    if (against === undefined) return undefined;
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

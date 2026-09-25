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
import { relative, resolve } from 'node:path';
import {
  askCoverageFile,
  caseLayerFiles,
  changedLines,
  coveringChange,
  distanceToSource,
  readCommitRuns,
  readJourneyChange,
  testCoverageFile,
  testsGovernedBy,
  type CommitRuns,
  type CoveringRegion,
  type ExecutionIndex,
  type FileReading,
  type LineRange,
} from '@variance-authority/sense/test-selection';
import type { Relations } from '@variance-authority/core/relate';
import { OperatorError } from '../exit.js';
import type { ParsedReview } from '../review-args.js';
import { regionState } from './covering-frame.js';
import { motionAgainst, motionOfLast, type CoveringMotion } from './covering-motion.js';
import { readExecutionFor, readExecutionIndex, recordedExecutionFile } from './execution-input.js';
import { installDiff, type DiffPoint, type InstallDiff } from './installed.js';
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
  /** What `from` came from: `--since`, or the commit the recording stood at before these runs. */
  readonly base: 'since' | 'recording';
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
  const coverageFile = testCoverageFile(root);
  const runs = await readCommitRuns(coverageFile);
  const ref = request.since ?? runs?.over;
  if (ref === undefined) {
    throw new OperatorError(
      runs === undefined
        ? `no run has listed itself beside \`${coverageFile}\`, so nothing says where this change starts. ` +
            'Run the suite with `withTestSelection` first, or name the base with `--since <ref>`.'
        : `the runs at ${runs.commit?.slice(0, 12) ?? 'this checkout'} were not laid over a recording of ` +
            'the same instrumentation, so nothing says where this change starts. Name the base with `--since <ref>`.',
      { kind: 'unrecorded' },
    );
  }

  const point = await diffPoint(ref);
  const forward = point === undefined ? undefined : await diffSince(ref, [], point.base);
  const backward = point === undefined ? undefined : await diffSince(ref, [], point.base, { reverse: true });
  if (point === undefined || forward === undefined || backward === undefined) {
    throw new OperatorError(
      `\`${ref}\` could not be read as a diff. Check the commit is in this checkout's history: ` +
        'a shallow clone holds only the tip, so fetch the base, or check out with `fetch-depth: 0`.',
    );
  }

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

  const from = await recordedExecutionFile(root);
  const now = inTreeLines(changedLines(backward), root, readings);
  const { index } = await readExecutionFor(from, now);
  const covered = new Map(
    coveringChange(index, now, { relations }).map((file) => [file.file, file]),
  );
  const full = await readExecutionIndex(from);
  const held = await baseIndex(request.against, from);
  const near = await nearTests(coverageFile, [...covered.values()].filter((file) => file.recorded).map((file) => file.file), relations);

  const files: ReviewFile[] = [];
  for (const file of [...changed.keys()].sort()) {
    const read = readings.get(file);
    const change = covered.get(file);
    const ranges = now.get(file) ?? [];
    const created = await point.at(named(file)) === undefined && existsSync(resolve(root, file));
    const cases = casesMoved(file, held, full, created);
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
  const motion = request.against !== undefined
    ? await motionAgainst(from, request.against, ref, root)
    : runs === undefined
      ? undefined
      : await motionOfLast(full, from, full.tests.filter((test) => runs.files.includes(test.file)).map((test) => test.id), root);

  return {
    from: point.base,
    base: request.since === undefined ? 'recording' : 'since',
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
  };
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
 * The case index the change is compared with: the one `--against` names, or
 * the cases the latest run replaced. Absent when neither can be read.
 */
async function baseIndex(against: string | undefined, from: string): Promise<ExecutionIndex | undefined> {
  try {
    return await readExecutionIndex(against ?? caseLayerFiles(from).before);
  } catch (error) {
    if (against === undefined) return undefined;
    throw new OperatorError(
      `\`--against ${against}\` could not be read (${error instanceof Error ? error.message : String(error)}).`,
    );
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

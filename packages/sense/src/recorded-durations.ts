/**
 * What each recorded test file and test case cost, as its runner timed it.
 *
 * Read from what a recorded run published, the way `recordedCases` reads the
 * per-case index: the nearest layer holding one answers, for each suite the
 * root config declares — the snapshot for files, the case index beside it for
 * cases. Nothing here runs a test or times one. A duration is the runner's
 * figure, stored when the run was recorded; a file's is what running it cost,
 * the phases before its first case included (`fileCost`). A file or case whose
 * runner reported none is counted as untimed rather than as free.
 *
 * A scope narrows both halves the same way, and the counts are counted inside
 * it: `from` keeps the tests declared under a path, `to` the tests the record
 * says entered one (see `recorded-scope.ts`).
 */

// compass: variance-authority.reach

import { existsSync, readFileSync } from 'node:fs';
import { keepsCases } from './test-selection/case-record.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { decodeExecutionIndex, decodeExecutionTests } from './test-selection/execution-format.js';
import { fileCost } from './test-selection/file-cost.js';
import { NO_DURATION, PHASE_NAMES } from './test-selection/format-layout.js';
import type { TestCoverageView } from './test-selection/format-view.js';
import { recordDigestAt } from './test-selection/record-base.js';
import { nearestTestCoverage } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';
import type { SuiteTimes } from './test-selection/suite-selection.js';
import {
  countScope,
  pathsOfSnapshot,
  scopeOfCases,
  scopeOfSnapshot,
  type DurationScope,
  type ScopeCounts,
} from './recorded-scope.js';

export type { DurationScope, ScopeCounts } from './recorded-scope.js';

/** One test file and the milliseconds running it cost, as `fileCost` reads them. */
export interface TimedTestFile {
  readonly file: string;
  readonly duration: number;
}

/** One test case, the file that declares it, and the milliseconds its runner reported for it. */
export interface TimedTestCase {
  readonly file: string;
  /** The declaration path inside the file, as the case index names it. */
  readonly name: string;
  readonly duration: number;
}

/** One suite's slowest recorded cases, or why there is no case index to read. */
export type RecordedCaseDurations =
  | {
      readonly recording: string;
      /** The slowest first, at most the limit asked for. */
      readonly slowest: readonly TimedTestCase[];
      /** Every case the index holds a duration for. */
      readonly timed: number;
      /** Recorded cases whose runner reported no duration, or that an index older than durations holds. */
      readonly untimed: number;
      /** What each half of the scope matched in the case index. */
      readonly scope: ScopeCounts;
    }
  | { readonly recording: string; readonly unread: string };

/** One suite's slowest recorded files and cases, or why there is no recording to read. */
export type RecordedDurations = (
  | {
      readonly suite?: string;
      readonly recording: string;
      /** The slowest first, at most the limit asked for. */
      readonly slowest: readonly TimedTestFile[];
      /** Every file the recording holds a duration for. */
      readonly timed: number;
      /** Recorded files whose runner reported no duration, or that a recording older than durations holds. */
      readonly untimed: number;
      /** What each half of the scope matched in the snapshot. */
      readonly scope: ScopeCounts;
    }
  | { readonly suite?: string; readonly recording: string; readonly unread: string }
) & { readonly cases: RecordedCaseDurations };

/**
 * For each suite the root config declares, or the one record of a repository
 * that declares none: the `limit` test files and the `limit` test cases its
 * latest recording says took longest, slowest first, with ties in code-unit
 * order of path and then of name. Every count is of the tests inside `scope`.
 */
export function recordedDurations(
  root: string,
  limit: number,
  scope: DurationScope = {},
): readonly RecordedDurations[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const recording = nearestTestCoverage(root, { suite });
    const cases = caseDurations(recording, limit, scope);
    if (!existsSync(recording)) return { ...named, recording, unread: 'nothing is recorded there', cases };
    try {
      return { ...named, recording, cases, ...askCoverageFile(recording, (view) => {
        const paths = view.testPath.all();
        const costOf = costs(view);
        const timed: TimedTestFile[] = [];
        let untimed = 0;
        const counts = countScope(scopeOfSnapshot(view, scope), scope, paths.length, (test) => {
          const duration = costOf(test);
          if (duration === undefined) untimed += 1;
          else timed.push({ file: view.string(paths[test]!), duration });
        });
        timed.sort((left, right) => right.duration - left.duration || order(left.file, right.file));
        return { slowest: timed.slice(0, limit), timed: timed.length, untimed, scope: counts };
      }) };
    } catch (error) {
      return { ...named, recording, unread: messageOf(error), cases };
    }
  });
}

/** What running test `test` of `view` cost, as {@link fileCost} reads it; absent where its runner timed nothing. */
function costs(view: TestCoverageView): (test: number) => number | undefined {
  const durations = view.testDuration?.all();
  const phases = view.testPhases?.all();
  const width = PHASE_NAMES.length;
  return (test) => fileCost(durations?.[test] ?? NO_DURATION, phases?.subarray(test * width, (test + 1) * width));
}

/**
 * Every test file the snapshot at `recording` holds a duration for, and the
 * commit it was taken at: what a sharded run places its files by. A file whose
 * runner reported none is absent rather than zero, so the placement prices it
 * the way it prices a file the record never saw.
 *
 * Nothing recorded there is a reason, which every shard reads alike. A record
 * that is there and does not read throws: a shard placed by count beside one
 * that read it would take files the other takes.
 */
export function recordedTimes(recording: string): SuiteTimes {
  if (!existsSync(recording)) return { recording, unread: 'nothing is recorded there' };
  const placed = askCoverageFile(recording, (view) => {
    const paths = view.testPath.all();
    const costOf = costs(view);
    const times = new Map<string, number>();
    paths.forEach((path, test) => {
      const duration = costOf(test);
      if (duration !== undefined) times.set(view.string(path), duration);
    });
    return { times, ...(view.commit === undefined ? {} : { commit: view.commit }) };
  });
  // The record read, which a shard's record names (`record-base.ts`).
  return { recording, read: recordDigestAt(recording), ...placed };
}

/**
 * The `limit` slowest cases `file` declares, slowest first, as its recording's
 * case index holds them: what names the cases inside a file too slow to split
 * by shard. Absent when no run kept its cases, or the index cannot be read.
 */
export function fileCases(recording: string, file: string, limit: number): readonly TimedTestCase[] | undefined {
  const cases = caseDurations(recording, limit, { from: [file] });
  return 'unread' in cases ? undefined : cases.slowest;
}

/** The slowest cases in the case index at `recording`, which is the one beside the snapshot the durations were read from. */
function caseDurations(recording: string, limit: number, scope: DurationScope): RecordedCaseDurations {
  if (!keepsCases(recording)) return { recording, unread: 'no run kept its cases there' };
  try {
    const bytes = readFileSync(recording);
    // Only a `to` needs the crossings; the rest of the question is the test table.
    const index = scope.to === undefined ? { tests: decodeExecutionTests(bytes), modules: [] } : decodeExecutionIndex(bytes);
    const timed: TimedTestCase[] = [];
    let untimed = 0;
    const counts = countScope(scopeOfCases(index, scope), scope, index.tests.length, (at) => {
      const test = index.tests[at]!;
      if (test.duration === undefined) untimed += 1;
      else timed.push({ file: test.file, name: test.name, duration: test.duration });
    });
    timed.sort((left, right) =>
      right.duration - left.duration || order(left.file, right.file) || order(left.name, right.name));
    return { recording, slowest: timed.slice(0, limit), timed: timed.length, untimed, scope: counts };
  } catch (error) {
    return { recording, unread: messageOf(error) };
  }
}

/**
 * Every path the nearest recording of each suite holds a row for, test file or
 * module, in code-unit order: what a reader checks a path it was given against
 * when the checkout does not hold it.
 */
export function recordedPaths(root: string): readonly string[] {
  const paths = new Set<string>();
  for (const suite of declaredSuites(root)?.map((declared) => declared.name) ?? [undefined]) {
    const recording = nearestTestCoverage(root, { suite });
    if (!existsSync(recording)) continue;
    try {
      for (const path of askCoverageFile(recording, pathsOfSnapshot)) paths.add(path);
    } catch {
      // A recording that cannot be read suggests nothing; the answer already says why it is unread.
    }
  }
  return [...paths].sort(order);
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

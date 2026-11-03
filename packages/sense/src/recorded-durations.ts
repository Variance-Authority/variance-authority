/**
 * What each recorded test file and test case cost, as its runner timed it.
 *
 * Read from what a recorded run published, the way `recordedCases` reads the
 * per-case index: the nearest layer holding one answers, for each suite the
 * root config declares. Nothing here runs a test or times one. A file or case
 * whose runner reported no figure is counted apart, never as free. Each answer
 * says which record it read, because a figure is one reading, not an average.
 */

// compass: variance-authority.reach

import { existsSync, readFileSync } from 'node:fs';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { keepsCases } from './test-selection/case-record.js';
import { commitRunsFile } from './test-selection/commit-runs.js';
import { commitRunsIn } from './test-selection/commit-runs-text.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { decodeExecutionIndex, decodeExecutionTests } from './test-selection/execution-format.js';
import { fileCost } from './test-selection/file-cost.js';
import { NO_DURATION, PHASE_NAMES } from './test-selection/format-layout.js';
import type { TestCoverageView } from './test-selection/format-view.js';
import { recordDigestAt } from './test-selection/record-base.js';
import { nearestRecord, nearestTestCoverage, type RecordOrigin } from './test-selection/record-location.js';
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
export type { RecordOrigin } from './test-selection/record-location.js';

/** One test file and the milliseconds running it cost, as `fileCost` reads them. */
export interface TimedTestFile {
  readonly file: string;
  readonly duration: number;
}

/**
 * One test case, the file that declares it, and the milliseconds its runner
 * reported for it. Its `limit` ranks it a second way, by how much of that limit
 * it ran. A duration spans hooks and every attempt the record folded and a limit
 * bounds one attempt, so a passing case can read above its limit: the ranking
 * states the pair and judges neither.
 */
export interface TimedTestCase {
  readonly file: string;
  /** The declaration path inside the file, as the case index names it. */
  readonly name: string;
  readonly duration: number;
  /** The milliseconds its runner allowed one attempt; absent where no limit was recorded. */
  readonly limit?: number;
}

/** One suite's slowest recorded cases, or why there is no case index to read. */
export type RecordedCaseDurations =
  | {
      readonly recording: string;
      /** The slowest first, at most the limit asked for. */
      readonly slowest: readonly TimedTestCase[];
      /** The largest share of their limit first, at most the limit asked for. */
      readonly closest: readonly TimedTestCase[];
      /** The timed cases that hold a limit. */
      readonly limited: number;
      /** Every case the index holds a duration for, of those that ran at least the time asked. */
      readonly timed: number;
      /** Timed cases that ran less than the time asked. */
      readonly faster: number;
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
      readonly origin: RecordOrigin;
      /** The commit the record was taken at; absent where it names none. */
      readonly commit?: string;
      /** When the record's latest run landed, as ISO 8601; absent where no runs record beside it can say. */
      readonly landed?: string;
      /** The slowest first, at most the limit asked for. */
      readonly slowest: readonly TimedTestFile[];
      /** Every file the recording holds a duration for. */
      readonly timed: number;
      /** Recorded files whose runner reported no duration, or that a recording older than durations holds. */
      readonly untimed: number;
      /** What each half of the scope matched in the snapshot. */
      readonly scope: ScopeCounts;
    }
  | { readonly suite?: string; readonly recording: string; readonly origin: RecordOrigin; readonly unread: string }
) & { readonly cases: RecordedCaseDurations };

/**
 * For each suite the root config declares, or the one record of a repository
 * that declares none: the `limit` test files and the `limit` test cases its
 * latest recording says took longest, slowest first, with ties in code-unit
 * order of path and then of name. Every count is of the tests inside `scope`.
 * `over` keeps the cases that ran at least that many milliseconds.
 */
export function recordedDurations(
  root: string,
  limit: number,
  scope: DurationScope = {},
  over?: number,
): readonly RecordedDurations[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const { file: recording, origin } = nearestRecord(root, { suite });
    const cases = caseDurations(recording, limit, scope, over);
    if (!existsSync(recording)) return { ...named, recording, origin, unread: 'nothing is recorded there', cases };
    try {
      return { ...named, recording, origin, cases, ...askCoverageFile(recording, (view) => {
        const paths = view.testPath.all();
        const costOf = costs(view);
        const timed: TimedTestFile[] = [];
        let untimed = 0;
        const counts = countScope(scopeOfSnapshot(view, scope), scope, paths.length, (test) => {
          const duration = costOf(test);
          if (duration === undefined) untimed += 1;
          else timed.push({ file: view.string(paths[test]!), duration });
        });
        timed.sort((left, right) => right.duration - left.duration || codeUnitOrder(left.file, right.file));
        return {
          ...takenAt(recording, view.commit),
          slowest: timed.slice(0, limit),
          timed: timed.length,
          untimed,
          scope: counts,
        };
      }) };
    } catch (error) {
      return { ...named, recording, origin, unread: messageOf(error), cases };
    }
  });
}

/** The commit the record at `recording` names, and when the runs beside it say its latest run landed. */
function takenAt(recording: string, commit: string | undefined): { readonly commit?: string; readonly landed?: string } {
  return { ...(commit === undefined ? {} : { commit }), ...landedAt(commitRunsFile(recording)) };
}

function landedAt(runs: string): { readonly landed?: string } {
  try {
    return { landed: commitRunsIn(readFileSync(runs, 'utf8'), `the runs record at ${runs}`).latest };
  } catch {
    // The durations stand without their age, and the reader says the record does not hold it.
    return {};
  }
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
function caseDurations(recording: string, limit: number, scope: DurationScope, over = 0): RecordedCaseDurations {
  if (!keepsCases(recording)) return { recording, unread: 'no run kept its cases there' };
  try {
    const bytes = readFileSync(recording);
    // Only a `to` needs the crossings; the rest of the question is the test table.
    const index = scope.to === undefined ? { tests: decodeExecutionTests(bytes), modules: [] } : decodeExecutionIndex(bytes);
    const timed: TimedTestCase[] = [];
    let untimed = 0;
    let faster = 0;
    const counts = countScope(scopeOfCases(index, scope), scope, index.tests.length, (at) => {
      const { file, name, duration, limit: allowed } = index.tests[at]!;
      if (duration === undefined) untimed += 1;
      else if (duration < over) faster += 1;
      else timed.push({ file, name, duration, ...(allowed === undefined ? {} : { limit: allowed }) });
    });
    timed.sort((left, right) =>
      right.duration - left.duration || codeUnitOrder(left.file, right.file) || codeUnitOrder(left.name, right.name));
    const limited = timed.filter((test) => test.limit !== undefined);
    // Stable over the sort above, so an equal share keeps the longer run first.
    const closest = [...limited].sort((left, right) => shareOf(right) - shareOf(left));
    return {
      recording,
      slowest: timed.slice(0, limit),
      closest: closest.slice(0, limit),
      limited: limited.length,
      timed: timed.length,
      faster,
      untimed,
      scope: counts,
    };
  } catch (error) {
    return { recording, unread: messageOf(error) };
  }
}

function shareOf({ duration, limit }: TimedTestCase): number {
  return duration / limit!;
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
  return [...paths].sort(codeUnitOrder);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

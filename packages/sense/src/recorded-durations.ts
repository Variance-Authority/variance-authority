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
import type { CaseTime } from './test-selection/case-times.js';
import { commitRunsFile, type CommitRuns } from './test-selection/commit-runs.js';
import { commitRunsIn } from './test-selection/commit-runs-text.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import type { TestCoverageView } from './test-selection/format-view.js';
import { decodeExecutionIndex, decodeExecutionTests } from './test-selection/execution-format.js';
import { costs } from './test-selection/file-cost.js';
import { classKey, describeMachine, filesMachines, type Machine } from './test-selection/machine.js';
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
  /**
   * Every statement the case's body ran, as its line in `file` and its whole
   * microseconds on the real clock, in the order it first reached them, beside
   * what surrounded it as it ended; absent where the case was not cut.
   */
  readonly times?: readonly CaseTime[];
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

/** The slowest recorded files of one class of machine, ranked only against each other. */
export interface MachineDurations {
  /** The machine the files last ran on; absent for the files whose run named none. */
  readonly machine?: Machine;
  /** The slowest first, at most the limit asked for. */
  readonly slowest: readonly TimedTestFile[];
  /** The files of this class the recording holds a duration for. */
  readonly timed: number;
}

/** One suite's slowest recorded files and cases, or why there is no recording to read. */
export type RecordedDurations = (
  | {
      readonly suite?: string;
      readonly recording: string;
      readonly origin: RecordOrigin;
      /** The commit the record was taken at; absent where it names none. */
      readonly commit?: string;
      /** When the record's latest run landed, as ISO 8601; absent where no runs record beside it stands at this commit. */
      readonly landed?: string;
      /** The slowest first, at most the limit asked for. */
      readonly slowest: readonly TimedTestFile[];
      /** Every file the recording holds a duration for. */
      readonly timed: number;
      /**
       * The timed files grouped by the class of machine each last ran on, the
       * class with the slowest file first; absent where no run beside the
       * record names a machine. A figure is compared within its class only.
       */
      readonly machines?: readonly MachineDurations[];
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
        const { runs, ...taken } = runsTakenAt(recording, view.commit);
        const machines = runs === undefined ? undefined : byMachine(timed, filesMachines(runs), limit);
        return {
          ...taken,
          slowest: timed.slice(0, limit),
          timed: timed.length,
          ...(machines === undefined ? {} : { machines }),
          untimed,
          scope: counts,
        };
      }) };
    } catch (error) {
      return { ...named, recording, origin, unread: messageOf(error), cases };
    }
  });
}

/** The commit the record at `recording` names, and when its latest run landed if the runs beside it stand at that commit. */
export function takenAt(recording: string, commit: string | undefined): { readonly commit?: string; readonly landed?: string } {
  const { runs: _runs, ...taken } = runsTakenAt(recording, commit);
  return taken;
}

/** {@link takenAt}, with the runs record it read the landing from. */
function runsTakenAt(recording: string, commit: string | undefined): { readonly commit?: string; readonly landed?: string; readonly runs?: CommitRuns } {
  const runs = runsAt(recording, commit);
  return { ...(commit === undefined ? {} : { commit }), ...(runs === undefined ? {} : { landed: runs.latest, runs }) };
}

/** The runs record beside `recording`, where it stands at `commit`. */
function runsAt(recording: string, commit: string | undefined): CommitRuns | undefined {
  const beside = runsBeside(recording, commit);
  // The durations stand without their age or machine, and the reader says the record does not hold them.
  return beside !== undefined && 'runs' in beside ? beside.runs : undefined;
}

/** The runs record beside `recording` where it stands at `commit`, why not where one is there, undefined where none is. */
function runsBeside(recording: string, commit: string | undefined): { readonly runs: CommitRuns } | { readonly unread: string } | undefined {
  const path = commitRunsFile(recording);
  if (!existsSync(path)) return undefined;
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { unread: messageOf(error) };
  }
  return runsIn(text, `the runs record at ${path}`, commit);
}

/** The runs record `text`, read as `where`, where it stands at `commit`; why not where it does not. */
function runsIn(text: string, where: string, commit: string | undefined): { readonly runs: CommitRuns } | { readonly unread: string } {
  let held: CommitRuns;
  try {
    held = commitRunsIn(text, where);
  } catch (error) {
    return { unread: messageOf(error) };
  }
  // A landing that died between its two writes leaves a snapshot beside the runs of the commit before it.
  if (held.commit === commit) return { runs: held };
  return { unread: held.commit === undefined || commit === undefined ? "the runs record beside it carries no commit to match the record's" : 'the runs record beside it stands at another commit' };
}

/** The machine each test file ran on, as a reader says it, or why none is named. */
export type MachinesBeside = { readonly files: Readonly<Record<string, string>> } | { readonly unread: string };

/**
 * The machine each test file of the record at `recording` ran on, as the runs
 * beside it name it where they stand at the record's `commit`; why none is
 * named where a runs record is there; undefined where none is. A file the runs
 * name no one machine for is absent.
 */
export function machinesBeside(recording: string, commit: string | undefined): MachinesBeside | undefined {
  const beside = runsBeside(recording, commit);
  return beside === undefined ? undefined : machinesOf(beside);
}

/**
 * {@link machinesBeside} of the runs record `text` a share kept beside a
 * record at `commit`, read as `where`.
 */
export function machinesIn(text: string, where: string, commit: string | undefined): MachinesBeside {
  return machinesOf(runsIn(text, where, commit));
}

function machinesOf(beside: { readonly runs: CommitRuns } | { readonly unread: string }): MachinesBeside {
  if ('unread' in beside) return beside;
  const files: Record<string, string> = {};
  for (const [file, machine] of filesMachines(beside.runs)) if (machine !== undefined) files[file] = describeMachine(machine);
  return Object.keys(files).length === 0 ? { unread: 'the runs record beside it names no machine' } : { files };
}

/** `timed`, slowest first, grouped by the class of machine `machines` names each on; absent where it names none. */
function byMachine(
  timed: readonly TimedTestFile[],
  machines: ReadonlyMap<string, Machine | undefined>,
  limit: number,
): readonly MachineDurations[] | undefined {
  const classes = new Map<string, { machine?: Machine; files: TimedTestFile[] }>();
  for (const file of timed) {
    const machine = machines.get(file.file);
    const key = classKey(machine);
    const held = classes.get(key) ?? { ...(machine === undefined ? {} : { machine }), files: [] };
    held.files.push(file);
    classes.set(key, held);
  }
  if (![...classes.keys()].some((key) => key !== '')) return undefined;
  // `timed` is slowest first, so each class's first file is its slowest and the classes arrive in that order.
  return [...classes.values()].map(({ files, ...machine }) => ({ ...machine, slowest: files.slice(0, limit), timed: files.length }));
}

/**
 * Each test file an open record holds, in its order, and what running it cost
 * in ms: absent where the runner reported no time, never zero.
 */
export function fileTimes(view: TestCoverageView): readonly (readonly [file: string, ms: number | undefined])[] {
  const costOf = costs(view);
  return Array.from(view.testPath.all(), (path, test) => [view.string(path), costOf(test)] as const);
}

/**
 * Every test file the snapshot at `recording` holds a duration for, those it
 * holds none for, and the commit it was taken at: what a sharded run places its files by. A file whose
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
    const times = new Map<string, number>();
    const untimed: string[] = [];
    for (const [file, duration] of fileTimes(view)) {
      if (duration === undefined) untimed.push(file);
      else times.set(file, duration);
    }
    return { times, untimed, ...(view.commit === undefined ? {} : { commit: view.commit }) };
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
      const { file, name, duration, limit: allowed, times } = index.tests[at]!;
      if (duration === undefined) untimed += 1;
      else if (duration < over) faster += 1;
      else timed.push({ file, name, duration, ...(allowed === undefined ? {} : { limit: allowed }), ...(times === undefined ? {} : { times }) });
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

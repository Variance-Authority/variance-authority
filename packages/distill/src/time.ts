// compass: variance-authority/runtime/attention
import { NO_DURATION, openTestCoverage, PHASE_NAMES } from '@variance-authority/sense/test-selection';

/**
 * Where a scope's worker time went, as the runner timed each test file, phase
 * by phase. Every figure is milliseconds summed over the timed test files; a
 * phase no timed file reported is absent, never zero.
 */
export interface ScopeTime {
  /** The test files that reported both their collect and their cases. */
  readonly timed: number;
  /** The worker readying the file. */
  readonly prepare?: number;
  /** The test environment. */
  readonly environment?: number;
  /** The setup files. */
  readonly setup?: number;
  /** Importing the test file and running its top level, which is where its modules load. */
  readonly collect: number;
  /** Running the cases and their hooks. */
  readonly cases: number;
  /** Files whose loading took over {@link LOAD_BOUND} times as long as their cases, the longest loading first. */
  readonly loadBound: readonly { readonly file: string; readonly collect: number; readonly cases: number }[];
}

/** How many times its cases' time a file's loading has to take before loading is what the file costs. */
export const LOAD_BOUND = 10;

type Phase = (typeof PHASE_NAMES)[number];

/** Each record's timed test files by path, read once: the phase words in {@link PHASE_NAMES} order. */
function timesOf(record: Uint8Array): ReadonlyMap<string, Uint32Array> {
  const view = openTestCoverage(record);
  const phases = view.testPhases?.all();
  const times = new Map<string, Uint32Array>();
  if (phases === undefined) return times;
  const paths = view.testPath.all();
  const width = PHASE_NAMES.length;
  const collect = PHASE_NAMES.indexOf('collect');
  const cases = PHASE_NAMES.indexOf('cases');
  for (let test = 0; test < paths.length; test += 1) {
    const own = phases.subarray(test * width, (test + 1) * width);
    if (own[collect] === NO_DURATION || own[cases] === NO_DURATION) continue;
    times.set(view.string(paths[test]!), own);
  }
  return times;
}

/**
 * The time of the test files a scope reads, `file[at]` read from
 * `records[record[at]]`; absent when none of them reported its collect and cases.
 */
export function scopeTime(
  records: readonly Uint8Array[],
  files: readonly { readonly record: number; readonly file: string }[],
): ScopeTime | undefined {
  const read = new Map<number, ReadonlyMap<string, Uint32Array>>();
  const sum: (number | undefined)[] = PHASE_NAMES.map(() => undefined);
  const loadBound: { file: string; collect: number; cases: number }[] = [];
  let timed = 0;
  for (const { record, file } of files) {
    let times = read.get(record);
    if (times === undefined) read.set(record, (times = timesOf(records[record]!)));
    const own = times.get(file);
    if (own === undefined) continue;
    timed += 1;
    own.forEach((value, at) => {
      if (value !== NO_DURATION) sum[at] = (sum[at] ?? 0) + value;
    });
    const collect = own[PHASE_NAMES.indexOf('collect')]!;
    const cases = own[PHASE_NAMES.indexOf('cases')]!;
    if (collect > LOAD_BOUND * cases) loadBound.push({ file, collect, cases });
  }
  if (timed === 0) return undefined;
  const phases: Partial<Record<Phase, number>> = {};
  PHASE_NAMES.forEach((name, at) => {
    if (sum[at] !== undefined) phases[name] = sum[at];
  });
  loadBound.sort((left, right) => right.collect - left.collect || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0));
  return { timed, ...phases, collect: phases.collect!, cases: phases.cases!, loadBound };
}

/** How many load-bound files the text names; the JSON names every one. */
const LOAD_BOUND_SHOWN = 5;

function duration(milliseconds: number): string {
  return milliseconds < 10_000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

/** The lines a scope's time reads as, after the head of {@link formatScopeDistillation}. */
export function formatScopeTime(time: ScopeTime, files: number): readonly string[] {
  const total = PHASE_NAMES.reduce((total, name) => total + (time[name] ?? 0), 0);
  const row = (label: string, value: number | undefined): readonly string[] =>
    value === undefined ? [] : [`  ${label}: ${duration(value)}, ${total === 0 ? 0 : Math.round((100 * value) / total)}%`];
  const bound = time.loadBound;
  const sum = (key: 'collect' | 'cases'): number => bound.reduce((total, file) => total + file[key], 0);
  return [
    `Where the time went, as the runner timed ${time.timed} of the ${files} test file(s): ${duration(total)}.`,
    ...row('prepare, the worker readying the file', time.prepare),
    ...row('environment', time.environment),
    ...row('setup files', time.setup),
    ...row('collect, importing the test file and everything it loads', time.collect),
    ...row('cases', time.cases),
    ...(bound.length === 0
      ? []
      : [
        `Loading took over ten times as long as the cases in ${bound.length} test file(s): ` +
          `${duration(sum('collect'))} against ${duration(sum('cases'))}.`,
        ...bound.slice(0, LOAD_BOUND_SHOWN).map((file) =>
          `  ${file.file}: ${duration(file.collect)} loading, ${duration(file.cases)} in its cases`),
        ...(bound.length > LOAD_BOUND_SHOWN ? [`  and ${bound.length - LOAD_BOUND_SHOWN} more`] : []),
      ]),
  ];
}

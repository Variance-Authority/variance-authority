// compass: variance-authority/runtime/attention
import { codeUnitOrder } from '@variance-authority/core/segment';
import { NO_DURATION, openTestCoverage, PHASE_NAMES, timeBeforeCases } from '@variance-authority/sense/test-selection';

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
  /**
   * Files whose loading took longer than their cases, the longest loading
   * first. A file's `loading` is everything before its first case: the phases
   * above, summed, as `timeBeforeCases` reads them.
   */
  readonly loadBound: readonly { readonly file: string; readonly loading: number; readonly cases: number }[];
}

type Phase = (typeof PHASE_NAMES)[number];

/** Recorded milliseconds for one test file. A phase the runner did not time is absent. */
export type FileTime = Readonly<Partial<Record<Phase, number>>>;

const read = new WeakMap<Uint8Array, ReadonlyMap<string, Uint32Array>>();

/** Each record's timed test files by path, read once: the phase words in {@link PHASE_NAMES} order. */
function timesOf(record: Uint8Array): ReadonlyMap<string, Uint32Array> {
  const found = read.get(record);
  if (found !== undefined) return found;
  const view = openTestCoverage(record);
  const phases = view.testPhases?.all();
  const times = new Map<string, Uint32Array>();
  read.set(record, times);
  if (phases === undefined) return times;
  const paths = view.testPath.all();
  const width = PHASE_NAMES.length;
  for (let test = 0; test < paths.length; test += 1) {
    const own = phases.subarray(test * width, (test + 1) * width);
    if (own.every((value) => value === NO_DURATION)) continue;
    times.set(view.string(paths[test]!), own);
  }
  return times;
}

/** One file's recorded phases, including a partial reading, from the same reader the scope sums. */
export function fileTime(record: Uint8Array, file: string): FileTime | undefined {
  const own = timesOf(record).get(file);
  if (own === undefined) return undefined;
  const phases: Partial<Record<Phase, number>> = {};
  PHASE_NAMES.forEach((name, at) => {
    const value = own[at]!;
    if (value !== NO_DURATION) phases[name] = value;
  });
  return phases;
}

/**
 * The time of the test files a scope reads, `file[at]` read from
 * `records[record[at]]`; absent when none of them reported its collect and cases.
 */
export function scopeTime(
  records: readonly Uint8Array[],
  files: readonly { readonly record: number; readonly file: string }[],
): ScopeTime | undefined {
  const sum: (number | undefined)[] = PHASE_NAMES.map(() => undefined);
  const loadBound: { file: string; loading: number; cases: number }[] = [];
  let timed = 0;
  for (const { record, file } of files) {
    const own = timesOf(records[record]!).get(file);
    if (own === undefined || own[PHASE_NAMES.indexOf('collect')] === NO_DURATION || own[PHASE_NAMES.indexOf('cases')] === NO_DURATION) continue;
    timed += 1;
    own.forEach((value, at) => {
      if (value !== NO_DURATION) sum[at] = (sum[at] ?? 0) + value;
    });
    // A timed file reported its collect, so something came before its cases.
    const loading = timeBeforeCases(own)!;
    const cases = own[PHASE_NAMES.indexOf('cases')]!;
    if (loading > cases) loadBound.push({ file, loading, cases });
  }
  if (timed === 0) return undefined;
  const phases: Partial<Record<Phase, number>> = {};
  PHASE_NAMES.forEach((name, at) => {
    if (sum[at] !== undefined) phases[name] = sum[at];
  });
  loadBound.sort((left, right) => right.loading - left.loading || (codeUnitOrder(left.file, right.file)));
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
  const sum = (key: 'loading' | 'cases'): number => bound.reduce((total, file) => total + file[key], 0);
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
        `Loading took longer than the cases in ${bound.length} test file(s): ` +
          `${duration(sum('loading'))} against ${duration(sum('cases'))}.`,
        ...bound.slice(0, LOAD_BOUND_SHOWN).map((file) =>
          `  ${file.file}: ${duration(file.loading)} loading, ${duration(file.cases)} in its cases`),
        ...(bound.length > LOAD_BOUND_SHOWN ? [`  and ${bound.length - LOAD_BOUND_SHOWN} more`] : []),
      ]),
  ];
}

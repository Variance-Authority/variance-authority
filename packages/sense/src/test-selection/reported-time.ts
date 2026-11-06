/**
 * What a runner said a test file took, read into the record's fields. Nothing
 * here times a file: every figure is the runner's, and one it did not give, or
 * gave as something no duration can be, is left out.
 */
import { PHASE_NAMES } from './format-layout.js';

/**
 * Milliseconds a test file spent in each phase: the worker readying it, the
 * test environment, the setup files, loading the file with everything it
 * imports, and then its cases. `duration` is what the runner calls the file's
 * time, which for Jest holds every phase and for Vitest only the cases; these
 * read the same under both. A phase nobody timed is absent, never zero: Jest
 * times no `prepare`.
 */
export interface FilePhases {
  readonly prepare?: number;
  readonly environment?: number;
  readonly setup?: number;
  /** Importing the test file and running its top level, which is where its modules load. */
  readonly collect?: number;
  /** Running the cases and their hooks, from the first `beforeAll` to the last `afterAll`. */
  readonly cases?: number;
}

/** The runner's duration for a file, as a field to spread. */
export function reportedDuration(value: unknown): { readonly duration?: number } {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? { duration: value } : {};
}

/**
 * The phases the runner reported for a file, as a field to spread: each one a
 * duration {@link reportedDuration} would keep, and nothing when none is.
 */
export function reportedPhases(value: { readonly [phase in keyof FilePhases]?: unknown }): { readonly phases?: FilePhases } {
  const phases: Record<string, number> = {};
  for (const name of PHASE_NAMES) {
    const kept = reportedDuration(value[name]).duration;
    if (kept !== undefined) phases[name] = kept;
  }
  return Object.keys(phases).length === 0 ? {} : { phases };
}

/** Two runs' phases of one file, each the sum of both, and unknown where either did not say. */
export function summedPhases(held: FilePhases | undefined, more: FilePhases | undefined): { readonly phases?: FilePhases } {
  return reportedPhases(Object.fromEntries(PHASE_NAMES.map((name) => {
    const [one, other] = [held?.[name], more?.[name]];
    return [name, one === undefined || other === undefined ? undefined : one + other];
  })));
}

/**
 * What Jest timed of a file: `runtime` is the milliseconds it measured for the
 * whole file, and the stamps are the worker's `Date.now()`. A stamp it did not
 * set reads as a phase it did not time.
 */
export interface JestPerfStats {
  readonly runtime?: number;
  readonly loadTestEnvironmentStart?: number;
  readonly loadTestEnvironmentEnd?: number;
  readonly setupFilesStart?: number;
  readonly setupFilesEnd?: number;
  readonly setupAfterEnvStart?: number;
  readonly setupAfterEnvEnd?: number;
  readonly end?: number;
}

/**
 * A Jest file's phases: the environment and both kinds of setup file from
 * `perfStats`, and the rest split where the setup module saw jest-circus start
 * the file's run, in epoch milliseconds. `marks` are every such moment recorded
 * for the file's path: two Jest projects running one file each leave one, and
 * only the run's own falls inside its span. Jest readies no file apart from
 * these, so it reports no `prepare`; without exactly one mark inside the span
 * it reports no collect or cases.
 */
export function jestPhases(
  perfStats: JestPerfStats | undefined,
  marks: readonly number[],
): ReturnType<typeof reportedPhases> {
  if (perfStats === undefined) return {};
  // A missing stamp is `undefined`, and arithmetic on it a `NaN` that
  // `reportedPhases` leaves out, as it leaves out anything negative.
  const between = (start?: number, end?: number): number => (end ?? Number.NaN) - (start ?? Number.NaN);
  const { setupFilesStart, setupFilesEnd, setupAfterEnvStart, setupAfterEnvEnd, end } = perfStats;
  // A mark outside the file's own span is another run's, and two inside it
  // cannot be told apart: either way both halves go, never one with the
  // other's time in it.
  const inside = marks.filter((mark) => between(setupAfterEnvEnd, mark) >= 0 && between(mark, end) >= 0);
  const collected = inside.length === 1 ? inside[0] : undefined;
  const split = collected !== undefined;
  return reportedPhases({
    environment: between(perfStats.loadTestEnvironmentStart, perfStats.loadTestEnvironmentEnd),
    setup: between(setupFilesStart, setupFilesEnd) + between(setupAfterEnvStart, setupAfterEnvEnd),
    ...(split ? { collect: between(setupAfterEnvEnd, collected), cases: between(collected, end) } : {}),
  });
}

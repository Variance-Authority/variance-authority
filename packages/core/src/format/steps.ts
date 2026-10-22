/**
 * How long each step of reading one subject took.
 *
 * A step is a span of work the code already brackets as one phase — a
 * navigation, one stabilization wait, the screenshot, the decode — named by the
 * phase's own name. Each owner times only its own steps and hands the rest on
 * as data, so a subject's steps never overlap and never sum to more than what
 * the subject cost. A step that did not run is absent, never a zero: zero means
 * it ran and finished under the clock's resolution.
 *
 * Durations only, on a monotonic clock, and the wall time of the span: with
 * several worlds collecting side by side a step includes what the others cost
 * it, which is what it cost this run. Steps describe a reading and are part of
 * no digest, so a timing can never move an image, a key or a verdict.
 */

import { codeUnitOrder } from '../segment/index.js';

/** One step of one subject: the phase's own name and how long its span took. */
export interface Step {
  readonly step: string;
  /** Wall time of the span, in milliseconds, to a tenth. */
  readonly ms: number;
}

/** One step over a run: summed over the subjects that ran it, and how many did. */
export interface StepTotal {
  readonly step: string;
  readonly ms: number;
  readonly subjects: number;
}

/** Where one subject's steps are taken, in the order they ran; each owner times its own and passes the clock on. */
export interface StepClock {
  /** Run `job` as `step`. Taken whether it resolves or throws. */
  time<T>(step: string, job: () => Promise<T> | T): Promise<T>;
  /** Steps another owner timed, appended as they arrive, each name behind `prefix`. */
  add(steps: readonly Step[] | undefined, prefix?: string): void;
  /** The same list, with every name this view takes behind `prefix`. */
  within(prefix: string): StepClock;
  readonly taken: readonly Step[];
}

/** `now` is the owner's monotonic clock, in milliseconds: `performance.now` wherever it runs. */
export function stepClock(now: () => number): StepClock {
  return viewOf([], now, '');
}

function viewOf(taken: Step[], now: () => number, prefix: string): StepClock {
  return {
    async time(step, job) {
      const started = now();
      try {
        return await job();
      } finally {
        taken.push({ step: prefix + step, ms: tenths(now() - started) });
      }
    },
    add(steps, more = '') {
      for (const { step, ms } of steps ?? []) taken.push({ step: prefix + more + step, ms });
    },
    within(more) {
      return viewOf(taken, now, prefix + more);
    },
    taken,
  };
}

/** `job` as `step` on `steps`, or just `job` when nothing is timing it. */
export async function timeOn<T>(
  steps: StepClock | undefined,
  step: string,
  job: () => Promise<T> | T,
): Promise<T> {
  return steps === undefined ? job() : steps.time(step, job);
}

/** Each step's total over every subject that ran it, by name in code-unit order. */
export function totalsOf(subjects: readonly (readonly Step[] | undefined)[]): readonly StepTotal[] {
  const totals = new Map<string, { ms: number; subjects: number }>();
  for (const steps of subjects) {
    const seen = new Set<string>();
    for (const { step, ms } of steps ?? []) {
      const total = totals.get(step) ?? { ms: 0, subjects: 0 };
      total.ms += ms;
      if (!seen.has(step)) total.subjects += 1;
      seen.add(step);
      totals.set(step, total);
    }
  }
  return [...totals]
    .sort(([left], [right]) => codeUnitOrder(left, right))
    .map(([step, total]) => ({ step, ms: tenths(total.ms), subjects: total.subjects }));
}

function tenths(ms: number): number {
  return Math.round(ms * 10) / 10;
}

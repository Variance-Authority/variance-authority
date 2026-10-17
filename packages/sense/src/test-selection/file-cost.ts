/**
 * What a recorded test file cost to run, read from the two figures the record
 * keeps of it: `tests.duration`, the runner's own, and `tests.phases`. Every
 * reader that weighs a file by its time — ranking, shard placement, where a
 * scope's time went — asks here, so they all mean the same thing by it.
 *
 * The runner's duration covers what that runner chose to time: Jest's spans
 * the file's run, Vitest's only its cases. The phases are spans of the same
 * run, each counting a part of it. Each undercounts the one interval, so the
 * cost is the larger of the two: Jest's runtime unless its phases add up to
 * more, and the whole of Vitest's phases, which its duration is the last of.
 * A file with no phases costs its duration, as it did before phases were
 * recorded.
 */

// compass: variance-authority.reach

import { NO_DURATION, PHASE_NAMES } from './format-layout.js';

const CASES = PHASE_NAMES.indexOf('cases');

/**
 * Milliseconds a test file spent before its first case — readying the worker,
 * the environment, the setup files and importing the file — given its
 * {@link PHASE_NAMES} words, each {@link NO_DURATION} where the runner did not
 * time it. Absent when it timed none of them.
 */
export function timeBeforeCases(phases: ArrayLike<number> | undefined): number | undefined {
  return summed(phases, CASES);
}

/**
 * Milliseconds running a test file cost: the larger of the runner's `duration`
 * word and its phases summed, either {@link NO_DURATION} or absent where the
 * runner did not give it. Absent when it gave neither.
 */
export function fileCost(duration: number, phases: ArrayLike<number> | undefined): number | undefined {
  const timed = duration === NO_DURATION ? undefined : duration;
  const phased = summed(phases, PHASE_NAMES.length);
  return timed === undefined ? phased : phased === undefined ? timed : Math.max(timed, phased);
}

/** The phase words before `end` that the runner reported, summed; absent when it reported none. */
function summed(phases: ArrayLike<number> | undefined, end: number): number | undefined {
  if (phases === undefined) return undefined;
  let sum: number | undefined;
  for (let at = 0; at < end; at += 1) {
    const word = phases[at]!;
    if (word !== NO_DURATION) sum = (sum ?? 0) + word;
  }
  return sum;
}

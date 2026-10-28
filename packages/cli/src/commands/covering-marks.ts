// compass: variance-authority.reach

/**
 * The one mark each run of lines carries in an editor's gutter, read across
 * every declared suite.
 *
 * A gutter holds one icon a line, and suites overlap: the unit suite can leave
 * a function unwalked that an end-to-end journey walked. Each run of lines is
 * read as the cases of every suite that answered about it, through the same
 * `stateOf` one suite's range is read through, so no suite's word alone
 * decides the line and no editor ranks the suites (spec 0063, §6).
 */

import { stateOf, type ExecutionTest, type RangeState } from '@variance-authority/sense/test-selection';
import type { CoveringRange } from './covering-frame.js';
import type { SuiteAnswer } from './covering-suites.js';

/** One run of lines and the state the cases of every suite that ran it add up to. */
export interface GutterMark {
  readonly startLine: number;
  readonly endLine: number;
  /** Absent when the record cannot tell; see `stateOf`. */
  readonly state?: RangeState;
  /** Every suite with a range over these lines, nearest kind first. */
  readonly suites: readonly string[];
}

/**
 * The marks of a file, one per run of lines the suites' ranges cut it into.
 * Absent when no suite answered with ranges: a question about one line, or a
 * file every suite refused or holds only as a precondition. A stale suite has
 * no ranges, so it marks nothing.
 */
export function marksOf(suites: readonly SuiteAnswer[]): readonly GutterMark[] | undefined {
  const placed = suites.flatMap((one) =>
    'reason' in one || one.ranges === undefined ? [] : [{ suite: one.suite, ranges: one.ranges }]);
  if (placed.length === 0) return undefined;
  const cuts = [...new Set(placed.flatMap((one) => one.ranges.flatMap((range) => [range.startLine, range.endLine + 1])))]
    .sort((a, b) => a - b);
  const marks: GutterMark[] = [];
  for (let at = 0; at + 1 < cuts.length; at++) {
    const startLine = cuts[at]!;
    const endLine = cuts[at + 1]! - 1;
    const over = placed.flatMap((one) => {
      const range = one.ranges.find((candidate) => candidate.startLine <= startLine && endLine <= candidate.endLine);
      return range === undefined ? [] : [{ suite: one.suite, range }];
    });
    if (over.length === 0) continue;
    const state = stateOf(joined(over.map((one) => one.range)));
    marks.push({ startLine, endLine, ...(state === undefined ? {} : { state }), suites: over.map((one) => one.suite) });
  }
  return marks;
}

/** The ranges of several suites over one run of lines, read as one: a stop nobody recorded stays unknown. */
function joined(ranges: readonly CoveringRange[]): Pick<CoveringRange, 'tests' | 'loaded' | 'stopped'> {
  const stopped: ExecutionTest[] | undefined = ranges.every((range) => range.stopped !== undefined)
    ? ranges.flatMap((range) => range.stopped!)
    : undefined;
  return {
    tests: ranges.flatMap((range) => range.tests),
    ...(ranges.some((range) => range.loaded === true) ? { loaded: true as const } : {}),
    ...(stopped === undefined ? {} : { stopped }),
  };
}

// compass: variance-authority.reach

/**
 * The one mark each run of lines carries in an editor's gutter, read across
 * every declared suite.
 *
 * A gutter holds one icon a line, and suites overlap: the unit suite can leave
 * a function unwalked that an end-to-end journey walked. Each run of lines is
 * read as the cases of every suite that answered about it, through the same
 * `stateOf` one suite's range is read through, so no suite's word alone
 * decides the line and no editor ranks the suites (spec 0063).
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
  /** Every suite with a range over these lines, in the order the suites were answered. */
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

/**
 * The ranges of several suites over one run of lines, read as one: a stop nobody recorded stays
 * unknown, and a case two suites both ran is one case, since deleting it leaves both without it.
 * A case one suite ran in another text is not known to have run the lines unless another suite
 * says it called in.
 */
function joined(ranges: readonly CoveringRange[]): Pick<CoveringRange, 'tests' | 'loaded' | 'stopped' | 'overwritten'> {
  const stopped: ExecutionTest[] | undefined = ranges.every((range) => range.stopped !== undefined)
    ? once(ranges.flatMap((range) => range.stopped!))
    : undefined;
  const tests = once(ranges.flatMap((range) => range.tests));
  const called = new Set(tests.filter((test) => test.loaded !== true).map(key));
  const overwritten = once(ranges.flatMap((range) => range.overwritten ?? [])).filter((test) => !called.has(key(test)));
  return {
    tests,
    ...(ranges.some((range) => range.loaded === true) ? { loaded: true as const } : {}),
    ...(stopped === undefined ? {} : { stopped }),
    ...(overwritten.length === 0 ? {} : { overwritten }),
  };
}

/** A declared case by where it is declared, since each record numbers its own cases. */
function key(test: ExecutionTest): string {
  return `${test.file}\0${test.name}`;
}

/**
 * Each declared case once, named by where it is declared, since each record numbers its own
 * cases; one that walked the lines outranks one that was there only while its module loaded.
 */
function once<Case extends ExecutionTest & { readonly loaded?: true }>(cases: readonly Case[]): Case[] {
  const kept = new Map<string, Case>();
  for (const one of cases) {
    const held = kept.get(key(one));
    if (held === undefined || (held.loaded === true && one.loaded !== true)) kept.set(key(one), one);
  }
  return [...kept.values()];
}

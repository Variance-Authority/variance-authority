// compass: variance-authority.reach.crossings
/**
 * The cases whose run of a region is not known.
 *
 * A record cut to a text an edit wrote over a region keeps the cases that ran
 * the region at the text it was measured in, flagged ({@link
 * ExecutionCrossing.overwritten}): they ran another text there, so whether
 * they crossed this one is not known. A selection runs them. A reader names
 * none of them, and reads none of them as absence either: a region they alone
 * hold is neither entered nor unwalked, and its answer says which case ran it
 * is not known.
 */

import type { Relations } from '@variance-authority/core/relate';
import type { ExecutionBlock, ExecutionCrossing, ExecutionIndex, ExecutionTest } from './reverse.js';
import { ownedBlocks } from './shadowed.js';
import { blocksOfTarget, type SourceTestTarget } from './source-target.js';

/** The flagged cases on a target, and the regions of the target that hold one. */
export interface OverwrittenOn {
  /** In record order. */
  readonly tests: readonly ExecutionTest[];
  readonly regions: readonly Pick<ExecutionBlock, 'kind' | 'name' | 'startLine' | 'endLine'>[];
}

/**
 * Of the cases flagged on `blocks`, the ones that called into none of them, in
 * record order; absent when there are none. A case that called in elsewhere on
 * the blocks is named for them, and saying it again would say two things about
 * one case.
 */
export function overwrittenIn(index: ExecutionIndex, blocks: readonly ExecutionBlock[]): readonly ExecutionTest[] | undefined {
  const tests = flaggedIn(blocks);
  return tests.length === 0 ? undefined : tests.map((test) => caseAt(index, test));
}

function flaggedIn(blocks: readonly ExecutionBlock[]): readonly number[] {
  const called = new Set<number>();
  const flagged = new Set<number>();
  for (const block of blocks) {
    for (const crossing of block.crossings) {
      if (crossing.overwritten === true) flagged.add(crossing.test);
      else if (crossing.loaded !== true) called.add(crossing.test);
    }
  }
  return [...flagged].filter((test) => !called.has(test)).sort((left, right) => left - right);
}

/**
 * The cases flagged on the regions a target lands on that called into none of
 * them, with the regions that hold one; absent when there are none, and when
 * the record has no row for the file.
 */
export function overwrittenOn(
  index: ExecutionIndex,
  target: SourceTestTarget,
  options: { readonly relations?: Relations } = {},
): OverwrittenOn | undefined {
  const module = index.modules.find((candidate) => candidate.file === target.file);
  if (module === undefined) return undefined;
  const blocks = blocksOfTarget(ownedBlocks(index, module, options.relations), target);
  const flagged = new Set(flaggedIn(blocks));
  if (flagged.size === 0) return undefined;
  const holds = (crossing: ExecutionCrossing): boolean => crossing.overwritten === true && flagged.has(crossing.test);
  return {
    tests: [...flagged].map((test) => caseAt(index, test)),
    regions: blocks
      .filter((block) => block.source && block.crossings.some(holds))
      .map(({ kind, name, startLine, endLine }) => ({ kind, name, startLine, endLine })),
  };
}

function caseAt(index: ExecutionIndex, test: number): ExecutionTest {
  const found = index.tests[test];
  if (found === undefined) throw new Error(`invalid execution index: test ${test} does not exist`);
  return found;
}

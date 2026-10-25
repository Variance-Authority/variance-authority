// compass: variance-authority.reach
/**
 * Charging a measured file's recorded regions: every region of it, or the
 * regions its changed lines fall in, at the precision the suite selects by.
 *
 * Its own file because two callers ask it: the composed narrowing, which
 * charges what a reading left, and the operations a caller runs alone
 * (`operations.ts`), which charge what the caller handed over.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { blocksAround, regionOf } from './blocks-around.js';
import type { LineRange } from './diff-lines.js';
import type { TestCoverageView } from './format-view.js';
import { bindsOnly } from './inert.js';
import { testPathOf } from './lookup.js';
import type { SelectionCause, SelectionReason } from './narrowing.js';
import { declarationOf, type Precision } from './precision.js';
import type { Disowned } from './shadowed.js';

/** Charge one recorded block of the module held under `file`, for `reason`. */
export type Charge = (file: string, block: number, reason: SelectionReason) => void;

/** Selects every test that crossed a block, less those that disowned it (`shadowed.ts`). */
export function entering(
  coverage: TestCoverageView,
  disowned: Disowned | undefined,
  select: (test: number, reason: SelectionReason) => void,
): Charge {
  return (file, block, reason) => {
    for (const test of coverage.crossings.members(coverage.blockSet.at(block))) {
      if (disowned?.(file, test, block) !== true) select(test, reason);
    }
  };
}

/**
 * `enter` at `precision`. At function use a region stands for the declaration
 * it is in, found up its owner chain: every block that declaration holds, each
 * charged once.
 */
export function chargeAt(coverage: TestCoverageView, precision: Precision | undefined, enter: Charge): Charge {
  if (precision !== 'function-use') return enter;
  const widened = new Set<number>();
  return (file, block, reason) => {
    for (const one of declarationOf(coverage, block)) {
      if (widened.has(one)) continue;
      widened.add(one);
      enter(file, one, reason.kind === 'region' ? regionOf(coverage, reason.file, one) : reason);
    }
  };
}

/** Every region of every row `rowsOf` holds for `file`: every test that loaded it. */
export function chargeLoaded(
  coverage: TestCoverageView,
  file: string,
  rowsOf: ReadonlyMap<string, readonly number[]>,
  charge: Charge,
): void {
  for (const [name, rows] of rowsOf) {
    for (const module of rows) {
      for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
        charge(file, block, regionOf(coverage, name, block));
      }
    }
  }
}

/**
 * The regions `ranges` fall in, in every row `rowsOf` holds for `file`. No
 * ranges is every region: a file named without lines — a binary, a rename, a
 * mode — is changed whole.
 */
export function chargeLines(
  coverage: TestCoverageView,
  file: string,
  rowsOf: ReadonlyMap<string, readonly number[]>,
  ranges: readonly LineRange[],
  charge: Charge,
): void {
  for (const [name, rows] of rowsOf) {
    for (const module of rows) {
      const first = coverage.moduleBlocks.at(module);
      const end = coverage.moduleBlocks.at(module + 1);
      const blocks = new Set<number>();
      if (ranges.length === 0) for (let block = first; block < end; block += 1) blocks.add(block);
      for (const range of ranges) {
        // Text that only binds a name changed nothing that already ran, and
        // the gap it opens would otherwise be charged to the module itself —
        // every test that ever imported the file, for a function nobody calls
        // yet.
        if (range.added !== undefined && bindsOnly(range.added)) continue;
        for (const block of blocksAround(coverage, first, end, range)) blocks.add(block);
      }
      for (const block of blocks) charge(file, block, regionOf(coverage, name, block));
    }
  }
}

/** The tests a step selected, each with every reason it was selected for, and the `select` that fills it. */
export function selector(): {
  readonly selected: Map<number, SelectionReason[]>;
  readonly select: (test: number, reason: SelectionReason) => void;
} {
  const selected = new Map<number, SelectionReason[]>();
  return {
    selected,
    select: (test, reason) => {
      const reasons = selected.get(test) ?? [];
      reasons.push(reason);
      selected.set(test, reasons);
    },
  };
}

/** The selected tests by path, in code-unit order, each with its reasons. */
export function causesOf(coverage: TestCoverageView, selected: ReadonlyMap<number, readonly SelectionReason[]>): SelectionCause[] {
  return [...selected]
    .map(([test, via]): SelectionCause => ({ test: testPathOf(coverage, test), via }))
    .sort((left, right) => codeUnitOrder(left.test, right.test));
}

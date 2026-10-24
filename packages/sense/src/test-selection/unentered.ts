/**
 * The regions on a range that no case entered, though the range names cases.
 *
 * A range of the file answer names the cases an edit to its lines selects,
 * which is every region the line is charged to: a line that opens a branch is
 * the branch's and the enclosing function's. A region every line of which an
 * outer region also charges — a one-line branch, a one-line handler — has no
 * line of its own, so a list of the outer region's cases is painted over it and
 * the range reads as walked. Asked by function, the same region says nobody
 * went there. So a range says which of its regions nobody entered, and ranges
 * fold only where that list agrees.
 */

import type { ExecutionBlock, ExecutionIndex, ExecutionTest } from './reverse.js';
import { outside } from './stopped.js';

/** A region with source that no case entered, where it is recorded. */
export interface Unentered {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** The stopped cases that could have reached it: none makes it unwalked, some a hole. Absent when that cannot be told. */
  readonly stopped?: readonly ExecutionTest[];
}

/**
 * Of `blocks`, the ones with source no case entered, by call or while their
 * module evaluated, each with the stopped cases that could have reached it;
 * absent when there are none, or when the range names no case and so already
 * says nobody entered it.
 */
export function unenteredOn(
  index: ExecutionIndex,
  stopped: ReadonlySet<number> | undefined,
  blocks: readonly ExecutionBlock[],
  named: number,
): readonly Unentered[] | undefined {
  if (named === 0) return undefined;
  const found = blocks
    .filter((block) => block.source && block.loaded !== true && block.crossings.length === 0)
    .map((block): Unentered => {
      const short = outside(index, stopped, [block]);
      return {
        kind: block.kind, name: block.name, path: block.path, startLine: block.startLine, endLine: block.endLine,
        ...(short === undefined ? {} : { stopped: short }),
      };
    });
  return found.length === 0 ? undefined : found;
}

/** Whether two ranges' unentered regions are the same ones, so the ranges may fold. */
export function sameUnentered(left: readonly Unentered[] | undefined, right: readonly Unentered[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((region, at) =>
    region.path === right[at]!.path && region.startLine === right[at]!.startLine && region.endLine === right[at]!.endLine,
  );
}

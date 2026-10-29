// compass: variance-authority.reach.crossings
/**
 * The regions on a range that no case entered, though the range names cases.
 *
 * A range of the file answer names the cases an edit to its lines selects,
 * which is every region the line is charged to: a line that opens a branch is
 * the branch's and the enclosing function's. On such a line the outer region's
 * cases are painted over a region nobody entered, and the range reads as
 * walked. A one-line branch or handler has no other line, so nothing else says
 * nobody went there; a longer region's opening line says it beside the lines
 * that are the region's own. So a range says which of its regions nobody
 * entered, and ranges fold only where that list agrees.
 */

import { reachOf, type ReachRecord } from './range-state.js';
import type { ExecutionBlock, ExecutionTest } from './reverse.js';

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
 * says nobody entered it. Whether a block was entered is `reachOf` over the
 * record `recordOf` reads for it, the reading every covering answer shares.
 */
export function unenteredOn(
  blocks: readonly ExecutionBlock[],
  named: number,
  recordOf: (block: ExecutionBlock) => ReachRecord,
): readonly Unentered[] | undefined {
  if (named === 0) return undefined;
  const found: Unentered[] = [];
  for (const block of blocks) {
    if (!block.source) continue;
    const record = recordOf(block);
    const reach = reachOf(record);
    // A region a case ran in another text is not shown as one nobody entered.
    if (reach === 'entered' || reach === 'loaded' || reach === 'overwritten') continue;
    found.push({
      kind: block.kind, name: block.name, path: block.path, startLine: block.startLine, endLine: block.endLine,
      ...(record.stopped === undefined ? {} : { stopped: record.stopped }),
    });
  }
  return found.length === 0 ? undefined : found;
}

/** Whether two ranges' unentered regions are the same ones, so the ranges may fold. */
export function sameUnentered(left: readonly Unentered[] | undefined, right: readonly Unentered[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((region, at) => region.name === right[at]!.name
    && region.path === right[at]!.path && region.startLine === right[at]!.startLine && region.endLine === right[at]!.endLine);
}

/**
 * The one sentence every answer says about a region no case entered, with why:
 * `no case entered the branch on line 6`, then {@link whyUnentered}.
 */
export function unenteredSentence(region: Unentered): string {
  const lines = region.startLine === region.endLine ? `line ${region.startLine}` : `lines ${region.startLine}-${region.endLine}`;
  return `no case entered the ${region.kind} on ${lines}${whyUnentered(region.stopped)}`;
}

/**
 * Why nobody entered, closing the sentence that said so: a hole, unwalked, or
 * a record that cannot tell them apart. A case that stopped recorded where it
 * went and nothing past that, so the absence of its name is not evidence, and a
 * bare *nobody entered* over a hole would read as permission to delete the code.
 */
export function whyUnentered(stopped: readonly ExecutionTest[] | undefined): string {
  if (stopped === undefined) return '.';
  if (stopped.length === 0) return ', and every case that could have reached it finished: unwalked.';
  return ` — a hole: ${stopped.length === 1 ? 'a case' : `${stopped.length} cases`} that could have reached it stopped first, so the record cannot see it.`;
}

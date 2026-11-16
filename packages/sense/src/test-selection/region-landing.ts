/**
 * A module as one cut of its text, and whether two cuts are one.
 *
 * A case index keeps each module at the lines it was recorded at, and a
 * snapshot's rows of it may stand at another cut. Which held region a recorded
 * one stands for, and whether two cuts were cut at one text, are the addon's
 * (`native/src/case_layer_landing.rs`).
 */

import type { SetExecutionModule } from './execution-set-format.js';

/**
 * Whether two cuts hold the same regions at the same lines, in one order: one
 * cut of one text, read without pairing a region. A run that re-cut nothing
 * leaves most modules so.
 */
export function sameCut(left: Cut, right: Cut): boolean {
  return left.blocks.length === right.blocks.length && left.blocks.every((block, at) => {
    const other = right.blocks[at]!;
    return block.startLine === other.startLine && block.endLine === other.endLine &&
      block.kind === other.kind && block.name === other.name && block.path === other.path;
  });
}

/** What one cut of a module says of a region: its address, its kind and the lines it stands at. */
type Region = Pick<SetExecutionModule['blocks'][number], 'kind' | 'name' | 'path' | 'startLine' | 'endLine'>;

/** A module as one cut of its text: a case index's module, or a snapshot's rows of it. */
export interface Cut {
  readonly blocks: readonly Region[];
}

/**
 * Where a held module's regions stand among a cut of it recorded now.
 *
 * A case index keeps each module at the lines it was recorded at, and a
 * snapshot's rows of it may stand at another cut. Reading the two together
 * asks whether they are one cut of one text, and which held region each
 * recorded one stands for. Laying a run's cases over an edit is the addon's
 * (`native/src/case_layer_landing.rs`).
 */

import type { SetExecutionModule } from './execution-set-format.js';
import { addressKey } from './carried-rows.js';

/**
 * Whether `held` was cut at the text `recorded` was: every region the two cuts
 * both hold an address for stands at the same lines in each. A region one cut
 * holds and the other lacks says nothing either way, so two cuts that share no
 * address are alike.
 */
export function cutAlike(held: Cut, recorded: Cut): boolean {
  // FIXME: `cut_alike` in `native/src/case_layer_landing.rs` is the test a run
  // lays its cases by; this should ask the addon for it.
  for (const [from, block] of landedOn(held, recorded)) {
    if (held.blocks[from]!.startLine !== recorded.blocks[block]!.startLine) return false;
    if (held.blocks[from]!.endLine !== recorded.blocks[block]!.endLine) return false;
  }
  return true;
}

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

/** Whether some region of `held` lands on one of `recorded`: the two cuts hold an address in common. */
export function sharesRegion(held: Cut, recorded: Cut): boolean {
  return landedOn(held, recorded).size > 0;
}

/** Each held region a recorded one lands on, by {@link landing}, and the recorded one. */
function landedOn(held: Cut, recorded: Cut): Map<number, number> {
  const to = new Map<number, number>();
  for (const [block, from] of landing(recorded, held).entries()) if (from >= 0) to.set(from, block);
  return to;
}

/**
 * For each region recorded now, the held region of the same cut it stands for,
 * or -1.
 *
 * An address is half a seat among siblings, and a run that read a file through
 * its source and its build keeps only the regions both cut alike, so one cut
 * can lack a region the other holds. Where the two cuts hold an address a
 * different number of times, a region lands only on the held one at its own
 * lines. Where cases go over an edit is `native/src/case_layer_landing.rs`'s.
 */
function landing(recorded: Cut, before: Cut): Int32Array {
  // One pair is asked this more than once.
  const known = landed.get(recorded)?.get(before);
  if (known !== undefined) return known;
  const found = landingOf(recorded, before);
  if (!landed.has(recorded)) landed.set(recorded, new WeakMap());
  landed.get(recorded)!.set(before, found);
  return found;
}

/** {@link landing} by pair. Modules are read-only, so an answer stands while both do. */
const landed = new WeakMap<Cut, WeakMap<Cut, Int32Array>>();

function landingOf(recorded: Cut, before: Cut): Int32Array {
  const [heldCount, recordedCount] = [addressCounts(before.blocks), addressCounts(recorded.blocks)];
  const seen = new Map<string, number>();
  // Lines are a seat among siblings the two cuts hold a different number of; two callbacks on one line still part by order.
  const keyOf = (block: Region): string => {
    const key = address(block);
    return addressKey(heldCount.get(key) === recordedCount.get(key) ? key : `${key}\0@${block.startLine}-${block.endLine}`, seen);
  };
  const heldAt = new Map<string, number>();
  for (const [at, block] of before.blocks.entries()) heldAt.set(keyOf(block), at);
  seen.clear();
  return Int32Array.from(recorded.blocks, (block) => {
    const at = heldAt.get(keyOf(block));
    return at !== undefined && before.blocks[at]!.kind === block.kind ? at : -1;
  });
}

/** What one cut of a module says of a region: its address, its kind and the lines it stands at. */
type Region = Pick<SetExecutionModule['blocks'][number], 'kind' | 'name' | 'path' | 'startLine' | 'endLine'>;

/** A module as one cut of its text: a case index's module, or a snapshot's rows of it. */
export interface Cut {
  readonly blocks: readonly Region[];
}

function address(block: Region): string {
  return `${block.name}\0${block.path}`;
}

function addressCounts(blocks: readonly Region[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) counts.set(address(block), (counts.get(address(block)) ?? 0) + 1);
  return counts;
}

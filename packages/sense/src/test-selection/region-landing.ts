/**
 * Where a held module's regions stand among a cut of it recorded now.
 *
 * A case index keeps each module at the lines it was recorded at. Laying a run
 * over one asks, of a module the run recorded again, which held region each
 * recorded one carries its cases from, and whether the held cut can be read at
 * the recorded lines at all.
 */

import type { SetExecutionModule } from './execution-set-format.js';
import { addressKey, sameNumbering } from './merge-carry.js';

/**
 * `held` at the lines `recorded` stands its regions on, when the two are named
 * at one text; `undefined` when `held` was cut at another text and cannot be
 * carried onto this one.
 *
 * Each held region is read at the recorded region of its address. When every
 * line agrees, `held` was cut at the text it is named at and comes back as it
 * was, whatever regions one cut holds and the other lacks. When a line does
 * not, `held` was cut at an older text, and its regions take the recorded
 * lines only where the two texts numbered alike ({@link sameNumbering}), the
 * rule the snapshot re-cut its rows to the newer text by. Then a held region
 * the recorded cut has no address for is left out: no line of the newer text
 * holds it, and kept at a line of the older one it would pair with whatever
 * region stands there now.
 */
// FIXME: regions told apart only by occurrence carry no seat for
// `sameNumbering` to compare, so a sibling taken out in front of them and
// another written behind keep their count and re-line each one onto its
// neighbour without a signal — the limit the snapshot's
// re-cut has. The index carrying the text each module was recorded from would
// let a reader leave such a module uncompared instead.
//
// FIXME: the re-lined module drops `owner`, since its kept regions are
// renumbered and the owners would have to be too. The before layer then names
// no region around any region of a module it re-lined, and when `layerBefore`
// lays it over an earlier before, a region the earlier one lacks takes none
// of its owner's cases.
export function relined(held: SetExecutionModule, recorded: SetExecutionModule): SetExecutionModule | undefined {
  const lands = landing(recorded, held, true);
  const to = new Map<number, number>();
  for (const [block, from] of lands.entries()) if (from >= 0) to.set(from, block);
  const moved = [...to].some(([from, block]) =>
    held.blocks[from]!.startLine !== recorded.blocks[block]!.startLine ||
    held.blocks[from]!.endLine !== recorded.blocks[block]!.endLine);
  if (!moved) return held;
  if (!sameNumbering(held.blocks, recorded.blocks)) return undefined;
  const kept = [...to.keys()].sort((left, right) => left - right);
  return {
    file: held.file,
    blocks: kept.map((from) => ({
      ...held.blocks[from]!,
      startLine: recorded.blocks[to.get(from)!]!.startLine,
      endLine: recorded.blocks[to.get(from)!]!.endLine,
    })),
    called: Uint32Array.from(kept, (from) => held.called[from]!),
    loaded: Uint8Array.from(kept, (from) => held.loaded[from]!),
  };
}

/**
 * For each region recorded now, the held region its cases carry from, or -1.
 *
 * An address is half a seat among siblings: a function written in front of an
 * anonymous one takes the seat it held. Where the two cuts filled a counter
 * differently over different text, an address names another region, and every
 * region is -1. Over the same text the seats are the text's: a run that read a
 * file through its source and its build keeps only the regions both cut alike,
 * so one cut can lack a region the other holds. A seat it lacks among regions
 * told apart only by occurrence moves every later sibling down one, so where
 * the two cuts of one text hold an address a different number of times, a
 * region lands only on the held one at its own lines, and the rest are absent
 * from the other cut rather than its neighbours.
 */
export function landing(recorded: SetExecutionModule, before: SetExecutionModule, sameText: boolean): Int32Array {
  // A layer asks one pair this up to four times: whether its text is the same,
  // where its cases land, and twice again for the before layer.
  const memo = landed[sameText ? 1 : 0];
  const known = memo.get(recorded)?.get(before);
  if (known !== undefined) return known;
  const found = landingOf(recorded, before, sameText);
  if (!memo.has(recorded)) memo.set(recorded, new WeakMap());
  memo.get(recorded)!.set(before, found);
  return found;
}

/** {@link landing} by the text the pair was named at: `[other, same]`. Modules are read-only, so an answer stands while both do. */
const landed = [
  new WeakMap<SetExecutionModule, WeakMap<SetExecutionModule, Int32Array>>(),
  new WeakMap<SetExecutionModule, WeakMap<SetExecutionModule, Int32Array>>(),
] as const;

function landingOf(recorded: SetExecutionModule, before: SetExecutionModule, sameText: boolean): Int32Array {
  if (!sameText && !sameNumbering(before.blocks, recorded.blocks)) return new Int32Array(recorded.blocks.length).fill(-1);
  const [heldCount, recordedCount] = [addressCounts(before.blocks), addressCounts(recorded.blocks)];
  const seen = new Map<string, number>();
  // Lines are a seat only over one text; two callbacks on one line still part by order.
  const keyOf = (block: Region): string => {
    const key = address(block);
    const byOrder = !sameText || heldCount.get(key) === recordedCount.get(key);
    return addressKey(byOrder ? key : `${key}\0@${block.startLine}-${block.endLine}`, seen);
  };
  const heldAt = new Map<string, number>();
  for (const [at, block] of before.blocks.entries()) heldAt.set(keyOf(block), at);
  seen.clear();
  return Int32Array.from(recorded.blocks, (block) => {
    const at = heldAt.get(keyOf(block));
    return at !== undefined && before.blocks[at]!.kind === block.kind ? at : -1;
  });
}

type Region = SetExecutionModule['blocks'][number];

function address(block: Region): string {
  return `${block.name}\0${block.path}`;
}

function addressCounts(blocks: readonly Region[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) counts.set(address(block), (counts.get(address(block)) ?? 0) + 1);
  return counts;
}

/**
 * Whether a held region went unmatched among siblings the two cuts hold a
 * different number of times: its cut lacked one the run recorded, or the text
 * changed under a name that says it did not, and nothing tells which.
 */
export function strayed(held: SetExecutionModule, recorded: SetExecutionModule): boolean {
  const matched = new Set(landing(recorded, held, true));
  const [heldCount, recordedCount] = [addressCounts(held.blocks), addressCounts(recorded.blocks)];
  return held.blocks.some((block, at) =>
    !matched.has(at) && recordedCount.has(address(block)) && heldCount.get(address(block)) !== recordedCount.get(address(block)));
}

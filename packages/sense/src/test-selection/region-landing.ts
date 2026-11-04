/**
 * Where a held module's regions stand among a cut of it recorded now.
 *
 * A case index keeps each module at the lines it was recorded at. Laying a run
 * over one asks, of a module the run recorded again, which held region each
 * recorded one carries its cases from, and whether the held cut can be read at
 * the recorded lines at all.
 */

import type { SetExecutionModule } from './execution-set-format.js';
import { NO_OWNER } from './format-layout.js';
import { addressKey, sameNumbering, seatedAlike } from './carried-rows.js';

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
 * region stands there now. A kept region's owner is the nearest region around
 * it that is kept too, so a region born under one still takes its cases.
 */
// FIXME: regions told apart only by occurrence carry no seat for
// `sameNumbering` to compare, so a sibling taken out in front of them and
// another written behind keep their count and re-line each one onto its
// neighbour without a signal — the limit the snapshot's
// re-cut has. The index carrying the text each module was recorded from would
// let a reader leave such a module uncompared instead.
export function relined(held: SetExecutionModule, recorded: SetExecutionModule): SetExecutionModule | undefined {
  if (cutAlike(held, recorded)) return held;
  if (!sameNumbering(held.blocks, recorded.blocks)) return undefined;
  const to = landedOn(held, recorded);
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
    ...(held.owner === undefined ? {} : { owner: keptOwners(held.owner, kept) }),
    ...(held.overwritten === undefined ? {} : { overwritten: Uint32Array.from(kept, (from) => held.overwritten![from]!) }),
  };
}

/**
 * Whether `held` was cut at the text `recorded` was: every region the two cuts
 * both hold an address for stands at the same lines in each. A region one cut
 * holds and the other lacks says nothing either way, so two cuts that share no
 * address are alike.
 */
export function cutAlike(held: Cut, recorded: Cut): boolean {
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

/** `owner` over the regions at `kept`, each walking out past the regions left out to the nearest kept one. */
function keptOwners(owner: Uint32Array, kept: readonly number[]): Uint32Array {
  const at = new Map(kept.map((from, position) => [from, position]));
  return Uint32Array.from(kept, (from) => {
    let around = owner[from]!;
    while (around !== NO_OWNER && !at.has(around)) around = owner[around]!;
    return around === NO_OWNER ? NO_OWNER : at.get(around)!;
  });
}

/**
 * For each region recorded now, the held region of the same cut it stands for,
 * or -1.
 *
 * An address is half a seat among siblings: a function written in front of an
 * anonymous one takes the seat it held. A run that read a file through its
 * source and its build keeps only the regions both cut alike, so one cut can
 * lack a region the other holds. A seat it lacks among regions told apart only
 * by occurrence moves every later sibling down one, so where the two cuts hold
 * an address a different number of times, a region lands only on the held one
 * at its own lines, and the rest are absent from the other cut rather than its
 * neighbours.
 *
 * This answers whether two cuts of one text agree. Where the cases of a region
 * go over an edit is {@link landedThrough}'s to say: it seats a region by the
 * lines the edit places it at first, and pairs by address only where both
 * cuts numbered their regions alike and the edit's reading spares the kind.
 */
function landing(recorded: Cut, before: Cut): Int32Array {
  // A layer asks one pair this up to four times.
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

/**
 * Whether an address names one region in both cuts: each holds it as many
 * times, and every counter it passes through handed out the same seats in
 * each ({@link seatedAlike}). Where the counts differ, one cut holds a sibling
 * the other lacks, and the n-th of one is not the n-th of the other; where a
 * counter's seats differ, an edit renumbered what it counts.
 */
export function addressedAlike(held: Cut, recorded: Cut): (block: Region) => boolean {
  const [heldCount, recordedCount] = [addressCounts(held.blocks), addressCounts(recorded.blocks)];
  const seated = seatedAlike(held.blocks, recorded.blocks);
  return (block) => heldCount.get(address(block)) === recordedCount.get(address(block)) && seated(block);
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
  const matched = new Set(landing(recorded, held));
  const [heldCount, recordedCount] = [addressCounts(held.blocks), addressCounts(recorded.blocks)];
  return held.blocks.some((block, at) =>
    !matched.has(at) && recordedCount.has(address(block)) && heldCount.get(address(block)) !== recordedCount.get(address(block)));
}

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
import { addressKey, addressOf, pairedRegions, sameNumbering } from './region-address.js';

/**
 * `held` at the lines `recorded` stands its regions on, when the two are named
 * at one text; `undefined` when `held` was cut at another text and cannot be
 * carried onto this one.
 *
 * Each held region is read at the recorded region of its address. When every
 * line agrees, `held` was cut at the text it is named at and comes back as it
 * was, whatever regions one cut holds and the other lacks. When a line does
 * not, `held` was cut at an older text, and its regions take the recorded
 * lines by the rule the snapshot re-cut its rows to the newer text by
 * ({@link pairedRegions} across texts): only where the two texts numbered
 * alike, and, since an index records no digest to tell twins apart by, never
 * for twins or for what is inside one. Then a held region the recorded cut has
 * no pair for is left out: no line of the newer text is known to hold it, and
 * kept at a line of the older one it would pair with whatever region stands
 * there now. A kept region's owner is the nearest region around it that is
 * kept too, so a region born under one still takes its cases.
 */
// FIXME: twins in a case index pair by nothing across an edit, so their cases
// are dropped and each twin takes the cases around it, where the rows of the
// same module pair them by body. The index records no digest, and the rows the
// snapshot holds for the module are not read where a run lands, nor always cut
// at the text the index was. An index cut at an older text whose regions all
// stand at the lines the newer one put them is read as cut at the newer text,
// so twins rewritten in place still pair by occurrence there. Carrying each
// region's digest in the index would pair both as `mergeCoverage` does.
export function relined(held: SetExecutionModule, recorded: SetExecutionModule): SetExecutionModule | undefined {
  if (cutAlike(held, recorded)) return held;
  if (!sameNumbering(held.blocks, recorded.blocks)) return undefined;
  const to = landedOn(held, recorded, false);
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
  };
}

/**
 * Whether `held` was cut at the text `recorded` was: every region the two cuts
 * both hold an address for stands at the same lines in each. A region one cut
 * holds and the other lacks says nothing either way, so two cuts that share no
 * address are alike.
 */
export function cutAlike(held: Cut, recorded: Cut): boolean {
  for (const [from, block] of landedOn(held, recorded, true)) {
    if (held.blocks[from]!.startLine !== recorded.blocks[block]!.startLine) return false;
    if (held.blocks[from]!.endLine !== recorded.blocks[block]!.endLine) return false;
  }
  return true;
}

/** Whether some region of `held` lands on one of `recorded`: the two cuts hold an address in common. */
export function sharesRegion(held: Cut, recorded: Cut): boolean {
  return landedOn(held, recorded, true).size > 0;
}

/** Each held region a recorded one lands on, by {@link landing}, and the recorded one. */
function landedOn(held: Cut, recorded: Cut, sameText: boolean): Map<number, number> {
  const to = new Map<number, number>();
  for (const [block, from] of landing(recorded, held, sameText).entries()) if (from >= 0) to.set(from, block);
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
 * For each region recorded now, the held region its cases carry from, or -1.
 *
 * Over different texts the regions pair as the snapshot's rows do
 * ({@link pairedRegions}): none where the two cuts filled a counter
 * differently, since an address is half a seat among siblings, and among twins
 * only by body, which an index does not record, so none.
 *
 * Over the same text the seats are the text's, but not by the rows' rule of
 * occurrence alone. A cut of rows is one walk over the text and holds all of
 * it; a run that read a file through its source and its build keeps only the
 * regions both cut alike, so one cut of an index can lack a region the other
 * holds. A seat it lacks among regions told apart only by occurrence moves
 * every later sibling down one, so where the two cuts of one text hold an
 * address a different number of times, a region lands only on the held one at
 * its own lines, and the rest are absent from the other cut rather than its
 * neighbours.
 */
export function landing(recorded: Cut, before: Cut, sameText: boolean): Int32Array {
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
  new WeakMap<Cut, WeakMap<Cut, Int32Array>>(),
  new WeakMap<Cut, WeakMap<Cut, Int32Array>>(),
] as const;

function landingOf(recorded: Cut, before: Cut, sameText: boolean): Int32Array {
  if (!sameText) {
    const from = pairedRegions(before.blocks, recorded.blocks, false);
    return from.map((at, block) => (at >= 0 && before.blocks[at]!.kind === recorded.blocks[block]!.kind ? at : -1));
  }
  const [heldCount, recordedCount] = [addressCounts(before.blocks), addressCounts(recorded.blocks)];
  const seen = new Map<string, number>();
  // Two callbacks on one line still part by order.
  const keyOf = (block: Region): string => {
    const key = addressOf(block);
    const byOrder = heldCount.get(key) === recordedCount.get(key);
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

/** What one cut of a module says of a region: its address, its kind and the lines it stands at. */
type Region = Pick<SetExecutionModule['blocks'][number], 'kind' | 'name' | 'path' | 'startLine' | 'endLine'>;

/** A module as one cut of its text: a case index's module, or a snapshot's rows of it. */
export interface Cut {
  readonly blocks: readonly Region[];
}

function addressCounts(blocks: readonly Region[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) counts.set(addressOf(block), (counts.get(addressOf(block)) ?? 0) + 1);
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
    !matched.has(at) && recordedCount.has(addressOf(block)) && heldCount.get(addressOf(block)) !== recordedCount.get(addressOf(block)));
}

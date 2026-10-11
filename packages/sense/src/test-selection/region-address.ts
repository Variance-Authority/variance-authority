/**
 * Where a region is in its module's tree, and the seats an address takes there.
 *
 * Two cuts of one module name a region by the same address: its declaration
 * name path and the structural path inside it. Every carry of evidence from one
 * cut onto another — the snapshot's rows, the case index's cases — pairs the
 * regions by it, so the address is spelled here once for all of them.
 */

import type { CoverageBlock } from './index.js';

/** Name path and structural path together: where a region is in the module's tree. */
export function addressOf(block: Addressed): string {
  return `${block.name}\0${block.path}`;
}

/** What an address is read off: a region's name path and structural path. */
type Addressed = Pick<CoverageBlock, 'name' | 'path'>;

/**
 * The same address told apart from the ones before it in the module: which
 * occurrence of it this row is.
 *
 * An address is not unique inside a module. A call-argument closure is named
 * after the callee it is an argument to, so two `useEffect(() => …)` bodies in
 * one component are both `<component>/useEffect.arg0` at `entry` — one address
 * over two regions, and the shape is ordinary React rather than a corner. Rows
 * placed by the bare address all land on the first row that answers to it, and
 * the crossings of every later region overwrite the ones before them: one
 * region's tests are dropped and another's are carried onto lines they were
 * never recorded against, with no demotion, because every previous row did find
 * somewhere to go. A diff inside the first of the twins is then answered with
 * the tests that entered the second, and the test that entered exactly those
 * lines is skipped.
 *
 * So repeats are told apart by their occurrence number in the order the recipe
 * numbered the regions, which is the order both sides read them in. Over one
 * text the n-th of an address carries onto the n-th of it that is still there,
 * and one that is gone loses its crossings the way any deleted region does —
 * through the unmatched-row path that demotes the tests standing on it. Over
 * two texts occurrence says nothing about which twin is which, and
 * {@link pairedAcrossEdit} pairs none of them.
 */
export function addressKey(address: string, seen: Map<string, number>): string {
  const nth = (seen.get(address) ?? 0) + 1;
  seen.set(address, nth);
  return `${address}\0${nth}`;
}

/**
 * For each region of `after`, the region of `before` its evidence carries
 * from, or -1: every region at its address and occurrence over one text, and
 * over two, nothing where the seats moved ({@link sameNumbering}) and
 * {@link pairedAcrossEdit} where they did not.
 */
export function pairedRegions(before: readonly Addressed[], after: readonly Addressed[], sameText: boolean): Int32Array {
  if (!sameText) {
    return sameNumbering(before, after) ? pairedAcrossEdit(before, after) : new Int32Array(after.length).fill(-1);
  }
  const seen = new Map<string, number>();
  const heldAt = new Map(before.map((block, at) => [addressKey(addressOf(block), seen), at] as const));
  seen.clear();
  return Int32Array.from(after, (block) => heldAt.get(addressKey(addressOf(block), seen)) ?? -1);
}

/**
 * For each region of `after`, the region of `before` it is, or -1, where the
 * two cuts are of different texts.
 *
 * A region is paired by its address, and only where the address picks out one
 * region in each cut. Twins — regions of one address, told apart only by
 * occurrence — are paired with nothing: take the first of two out and write a
 * third behind the second, and the cut holds two of the address again, the
 * first over the second's body. Occurrence pairs the recorded first onto it,
 * and the lines cannot object, because the text moved under them; the cut
 * holds no text to compare. A region inside a twin is paired with nothing
 * either, whatever its own address, since which twin holds it is the same
 * question. Nor is a twin of one cut paired with the one region of its address
 * in the other: which of the twins went, or which came, is unknown too.
 *
 * Nothing is lost by it. A region paired with nothing is born, and a born
 * region takes the evidence of the nearest region around it that was paired,
 * which every test that entered a twin entered too: the twin is charged the
 * tests that entered any of its siblings rather than those of the one at its
 * occurrence. Over one text, occurrence is the text's own order and pairs
 * twins truly; only the readers that know the texts differ ask this.
 *
 * Seated regions are not twins here: `anon#1` and `if#0` are addresses of their
 * own, and {@link sameNumbering} asks whether the seats still mean the same
 * regions.
 */
export function pairedAcrossEdit(before: readonly Addressed[], after: readonly Addressed[]): Int32Array {
  const twinned = new Set<string>();
  const counted = (blocks: readonly Addressed[]): ReadonlyMap<string, number> => {
    const counts = new Map<string, number>();
    for (const block of blocks) {
      const count = (counts.get(addressOf(block)) ?? 0) + 1;
      counts.set(addressOf(block), count);
      if (count > 1) twinned.add(block.name);
    }
    return counts;
  };
  counted(after);
  const held = counted(before);
  const inTwin = (name: string): boolean => {
    if (twinned.has(name)) return true;
    for (let at = name.lastIndexOf('/'); at > 0; at = name.lastIndexOf('/', at - 1)) {
      if (twinned.has(name.slice(0, at))) return true;
    }
    return false;
  };
  const heldAt = new Map<string, number>();
  for (const [at, block] of before.entries()) if (held.get(addressOf(block)) === 1) heldAt.set(addressOf(block), at);
  return Int32Array.from(after, (block) => (inTwin(block.name) ? -1 : heldAt.get(addressOf(block)) ?? -1));
}

/** A numbered step in an address: `if#0`, `for#12`, `anon#3`, never a `#private` member. */
const SEAT = /^(.*)#(\d+)$/;

/**
 * Every counter an address passes through, each with the number it took there.
 *
 * A counter is local to the place that holds it: the walk opens a fresh set for
 * each named declaration and keys them by the structural path and the kind
 * inside it, so `apply`'s branches are counted among `apply`'s branches and the
 * branches nested in one of them are counted among their own. The site is that
 * key read back off the address — everything up to the numbered step, plus what
 * was being counted — and the number is the seat the region took at it.
 */
export function seatsOf(block: Pick<CoverageBlock, 'name' | 'path'>): readonly (readonly [string, number])[] {
  const found: (readonly [string, number])[] = [];
  const steps = (path: string, from: string): string => {
    let at = from;
    for (const step of path === '' ? [] : path.split('/')) {
      const seat = SEAT.exec(step);
      if (seat !== null) found.push([`${at}/${seat[1]}`, Number(seat[2])]);
      at = `${at}/${step}`;
    }
    return at;
  };
  steps(block.path, `${steps(block.name, '')}\0`);
  return found;
}

/**
 * Whether the fresh cut seated its regions where the recorded one seated them.
 *
 * Half of an address is positional. The walk numbers each region among the
 * siblings of its kind in the place that holds them — `if#0/then`, `if#1/then`,
 * `anon#2` — in source order, so the number is not a name a region keeps but a
 * seat it occupies. Delete the first of two branches and the second one's
 * regions are cut as `if#0/*`: the address the deleted branch had, over text it
 * never covered. The kinds match, because a branch replaced a branch, so the
 * crossings of the region that is gone are carried onto the region that
 * survived, and the crossings recorded for the survivor — under the number it no
 * longer has — are dropped. Write a branch in front of it instead and the same
 * slide runs the other way, with the seat the recorded branch used to hold
 * filled by a region no run has ever entered, which is an empty crossing set
 * where the truth is that nobody measured it.
 *
 * Nothing downstream can see it. Arrival nests, so the tests that lost their
 * region still hold the function and the module and no demotion answers for
 * them, and the re-cut rows are written with the digest of the text standing
 * now, so the reader that checks whether a module's coordinates are still the
 * tree's agrees and charges nothing. A diff inside the surviving branch is then
 * answered with the test that entered the deleted one, and the test that entered
 * exactly those lines is in the caller's skip list.
 *
 * So the seats are counted first, one counter at a time. Where both cuts
 * numbered something at the same site, the seats taken there have to be the same
 * ones: two cuts agreeing on which numbers a counter handed out is what makes a
 * number mean the same region in both. When they disagree the module is mislaid,
 * because a counter that hands out a different set of numbers has moved
 * everything behind the one that changed — the shift is never local to the
 * sibling that moved.
 *
 * A site only one cut counted anything at is left alone, and that is the common
 * carry rather than a corner. A function written under an old one opens counters
 * of its own and moves nothing already numbered; a branch nested inside an
 * existing one opens another; deleting `decide` takes `decide/if#0/then` with it
 * and renumbers nothing around it. Those are ordinary gained and lost regions,
 * which the re-cut already answers — a gained one from the region around it, a
 * lost one through the crossings it nests into — and mislaying a whole module
 * over one would retire evidence still true about every other line in the file.
 *
 * What is left is a counter whose population changed, and there the two readings
 * are a region appended after the last one and a region pushed in front of the
 * first. The addresses are the same either way, and the table holds nothing that
 * tells them apart, so the module is mislaid for both: an ambiguity answered by
 * guessing is a false skip half the time, and answered by carrying the module as
 * it was it is a file charged whole until some run records it again.
 */
export function sameNumbering(
  before: readonly Pick<CoverageBlock, 'name' | 'path'>[],
  after: readonly Pick<CoverageBlock, 'name' | 'path'>[],
): boolean {
  const seats = (blocks: readonly Pick<CoverageBlock, 'name' | 'path'>[]): ReadonlyMap<string, ReadonlySet<number>> => {
    const sites = new Map<string, Set<number>>();
    for (const block of blocks) {
      for (const [site, seat] of seatsOf(block)) {
        const taken = sites.get(site) ?? new Set<number>();
        taken.add(seat);
        sites.set(site, taken);
      }
    }
    return sites;
  };
  const now = seats(after);
  for (const [site, taken] of seats(before)) {
    const holds = now.get(site);
    if (holds === undefined) continue;
    if (holds.size !== taken.size || [...taken].some((seat) => !holds.has(seat))) return false;
  }
  return true;
}

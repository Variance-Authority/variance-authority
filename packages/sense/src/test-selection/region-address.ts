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

/**
 * What an address is read off — a region's name path and structural path — and,
 * where the cut records them, what tells namesakes at one address apart: the
 * digest of the region's own text, and its place in the tree, the ordinal the
 * walk gave it and the ordinal of the region around it.
 */
type Addressed = Pick<CoverageBlock, 'name' | 'path'> & Partial<Pick<CoverageBlock, 'digest' | 'ordinal' | 'owner'>>;

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
 * somewhere to go. A diff inside the first of the namesakes is then answered
 * with the tests that entered the second, and the test that entered exactly
 * those lines is skipped.
 *
 * So repeats are told apart by their occurrence number in the order the recipe
 * numbered the regions, which is the order both sides read them in. Over one
 * text the n-th of an address carries onto the n-th of it that is still there,
 * and one that is gone loses its crossings the way any deleted region does —
 * through the unmatched-row path that demotes the tests standing on it. Over
 * two texts occurrence says nothing about which namesake is which, and
 * {@link pairedAcrossEdit} pairs them by their bodies instead.
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
 * A region is paired by its address where the address picks out one region in
 * each cut. Namesakes — regions of one address, told apart only by occurrence —
 * are not paired by occurrence: take the first of two out and write a third
 * behind the second, and the cut holds two of the address again, the first
 * over the second's body. Occurrence pairs the recorded first onto it, and the
 * lines cannot object, because the text moved under them.
 *
 * What a cut does hold is each region's digest: its own lines, with the lines
 * inside the regions it holds left to them, wherever in the file they stand. So
 * a namesake pairs with the namesake of the other cut whose digest is its own,
 * where that digest is held once among the regions of its address in each cut.
 * A namesake whose body changed, or whose body is a sibling's too, is paired
 * with nothing, and so is the one left over when the others pair: which of the
 * rest went and which came is the question occurrence could not answer, and
 * taking the one left over answers it by guessing. A digest taken of other text
 * — a region the map gave no lines keeps the one the addon took of the build —
 * matches none taken of the source and falls to unpaired the same way.
 *
 * The regions inside a paired namesake pair the same way under it: by address
 * where one region inside each namesake holds it, by digest among namesakes
 * nested in the namesake. A region inside a namesake paired with nothing is
 * paired with nothing either, whatever its own address, since which namesake
 * holds it is the same question. A cut that records no digest — a case index —
 * pairs no namesake and nothing inside one.
 *
 * Nothing is lost by it. A region paired with nothing is born, and a born
 * region takes the evidence of the nearest region around it that was paired,
 * which every test that entered a namesake entered too: the namesake is charged
 * the tests that entered any of its siblings rather than those of one it may
 * not be. Over one text, occurrence is the text's own order and pairs namesakes
 * truly; only the readers that know the texts differ ask this.
 *
 * Seated regions are not namesakes here: `anon#1` and `if#0` are addresses of
 * their own, and {@link sameNumbering} asks whether the seats still mean the
 * same regions.
 */
export function pairedAcrossEdit(before: readonly Addressed[], after: readonly Addressed[]): Int32Array {
  const paired = new Int32Array(after.length).fill(-1);
  pairWithin(treeOf(before), treeOf(after), [...before.keys()], [...after.keys()], paired);
  return paired;
}

/** A cut's regions and, where it records a digest for each, the position of the region around each one, or -1. */
interface Tree {
  readonly blocks: readonly Addressed[];
  readonly around: Int32Array | undefined;
}

function treeOf(blocks: readonly Addressed[]): Tree {
  const at = new Map<number, number>();
  for (const [position, block] of blocks.entries()) {
    if (block.digest === undefined || block.ordinal === undefined) return { blocks, around: undefined };
    at.set(block.ordinal, position);
  }
  return { blocks, around: Int32Array.from(blocks, (block) => (block.owner === undefined ? -1 : at.get(block.owner) ?? -1)) };
}

/**
 * {@link pairedAcrossEdit} over the regions at `heldAt` of `held` and at
 * `cutAt` of `cut`: the whole cuts, or the regions inside one pair of
 * namesakes.
 */
function pairWithin(held: Tree, cut: Tree, heldAt: readonly number[], cutAt: readonly number[], paired: Int32Array): void {
  const withNamesakes = new Set<string>();
  const holders = (tree: Tree, at: readonly number[]): ReadonlyMap<string, readonly number[]> => {
    const by = new Map<string, number[]>();
    for (const position of at) {
      const address = addressOf(tree.blocks[position]!);
      const holding = by.get(address) ?? [];
      holding.push(position);
      by.set(address, holding);
      if (holding.length > 1) withNamesakes.add(address);
    }
    return by;
  };
  const [heldBy, cutBy] = [holders(held, heldAt), holders(cut, cutAt)];
  // A region's name extends the name of every region around it, so a name at or
  // under a namesake's is inside a namesake; the tree is not needed for that
  // much.
  const names = new Set([...withNamesakes].map((address) => address.slice(0, address.indexOf('\0'))));
  const inNamesake = (name: string): boolean => {
    for (let end = name.length; end > 0; end = name.lastIndexOf('/', end - 1)) if (names.has(name.slice(0, end))) return true;
    return false;
  };
  for (const position of cutAt) {
    const block = cut.blocks[position]!;
    const was = heldBy.get(addressOf(block))?.[0];
    if (was !== undefined && !inNamesake(block.name)) paired[position] = was;
  }
  if (held.around === undefined || cut.around === undefined) return;
  const [heldIn, cutIn] = [nesting(held, heldAt, withNamesakes), nesting(cut, cutAt, withNamesakes)];
  for (const address of withNamesakes) {
    const heldBodies = bodies(held, heldBy.get(address));
    for (const [digest, [namesake, ...more]] of bodies(cut, cutBy.get(address))) {
      const [was, ...others] = heldBodies.get(digest) ?? [];
      if (namesake === undefined || was === undefined || more.length > 0 || others.length > 0) continue;
      if (!heldIn.outermost(was) || !cutIn.outermost(namesake)) continue;
      paired[namesake] = was;
      pairWithin(held, cut, heldIn.under(was), cutIn.under(namesake), paired);
    }
  }
}

/** The regions at `at` of one address, by digest. */
function bodies(tree: Tree, at: readonly number[] = []): ReadonlyMap<string, readonly number[]> {
  const by = new Map<string, number[]>();
  for (const position of at) {
    const digest = tree.blocks[position]!.digest!;
    const holding = by.get(digest) ?? [];
    holding.push(position);
    by.set(digest, holding);
  }
  return by;
}

/** Among the regions at `at`: whether one is inside no namesake of them, and the ones inside a given one. */
function nesting(tree: Tree, at: readonly number[], withNamesakes: ReadonlySet<string>) {
  const inside = new Set(at);
  const outward = (position: number): number[] => {
    const found: number[] = [];
    for (let next = tree.around![position]!; next >= 0 && inside.has(next); next = tree.around![next]!) found.push(next);
    return found;
  };
  return {
    outermost: (position: number): boolean => !outward(position).some((next) => withNamesakes.has(addressOf(tree.blocks[next]!))),
    under: (namesake: number): number[] => at.filter((position) => outward(position).includes(namesake)),
  };
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

/**
 * The carried module: rows a run did not re-record, with the crossings of the
 * tests it retired dropped, and the addresses and seats those rows carry by.
 *
 * Two crossing lists ride on every row and move together: `testFiles`, the
 * tests that entered the region, and `loadedBy`, the subset that entered it
 * before their first test began. Wherever one is filtered, carried or unioned
 * the other is too, and `loadedBy` is written only when it has something to
 * say — absent is the same fact as empty.
 */

import type { CoverageBlock, CoverageModule } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';

/**
 * A row with both crossing lists replaced, each distinct and in code-unit
 * order, and `loadedBy` present only when it is not empty.
 */
export function crossedBlock(
  block: CoverageBlock,
  testFiles: Iterable<string>,
  loadedBy: Iterable<string>,
): CoverageBlock {
  const early = [...new Set(loadedBy)].sort(codeUnitOrder);
  const row: CoverageBlock = { ...block, testFiles: [...new Set(testFiles)].sort(codeUnitOrder) };
  if (early.length > 0) return { ...row, loadedBy: early };
  if (row.loadedBy === undefined) return row;
  return {
    ordinal: row.ordinal,
    kind: row.kind,
    ...(row.owner === undefined ? {} : { owner: row.owner }),
    digest: row.digest,
    name: row.name,
    path: row.path,
    ...(row.startLine === undefined ? {} : { startLine: row.startLine, endLine: row.endLine }),
    source: row.source,
    testFiles: row.testFiles,
  };
}

/**
 * A carried module with retired crossings dropped, and the module itself when
 * it holds none of them.
 *
 * Almost every module in an index is carried. A run re-records the files it
 * loaded and the rest stand exactly as they were, so rebuilding each of them to
 * remove a handful of tests that entered none of their regions rebuilds the
 * whole index to change nothing — at two hundred thousand modules that is the
 * fold's entire cost and the peak the process is sized by. What a run retires
 * is what it re-recorded, which is small and local, so the answer for nearly
 * every module is the object that came in.
 */
export function withoutRetired(module: CoverageModule, retired: ReadonlySet<string>): CoverageModule {
  const holds = (block: CoverageBlock): boolean =>
    block.testFiles.some((test) => retired.has(test));
  if (retired.size === 0 || !module.blocks.some(holds)) return module;
  const kept = (test: string): boolean => !retired.has(test);
  return {
    ...module,
    blocks: module.blocks.map((block) =>
      holds(block)
        ? crossedBlock(block, block.testFiles.filter(kept), (block.loadedBy ?? []).filter(kept))
        : block,
    ),
  };
}

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
 * numbered the regions, which is the order both sides read them in. The n-th of
 * an address carries onto the n-th of it that is still there, and one that is
 * gone loses its crossings the way any deleted region does — through the
 * unmatched-row path that demotes the tests standing on it.
 */
export function addressKey(address: string, seen: Map<string, number>): string {
  const nth = (seen.get(address) ?? 0) + 1;
  seen.set(address, nth);
  return `${address}\0${nth}`;
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
  const now = sitesOf(after);
  for (const [site, taken] of sitesOf(before)) {
    const holds = now.get(site);
    if (holds !== undefined && !sameSeats(taken, holds)) return false;
  }
  return true;
}

/**
 * Whether the counters an address passes through handed out the same seats in
 * both cuts, so its number means one region in each: {@link sameNumbering}
 * asked of one address. A counter whose population changed renumbers what it
 * counts and everything nested under it, and nothing else.
 */
export function seatedAlike(
  before: readonly Pick<CoverageBlock, 'name' | 'path'>[],
  after: readonly Pick<CoverageBlock, 'name' | 'path'>[],
): (block: Pick<CoverageBlock, 'name' | 'path'>) => boolean {
  const [was, now] = [sitesOf(before), sitesOf(after)];
  return (block) => seatsOf(block).every(([site]) => sameSeats(was.get(site), now.get(site)));
}

function sitesOf(blocks: readonly Pick<CoverageBlock, 'name' | 'path'>[]): ReadonlyMap<string, ReadonlySet<number>> {
  const sites = new Map<string, Set<number>>();
  for (const block of blocks) {
    for (const [site, seat] of seatsOf(block)) {
      const taken = sites.get(site) ?? new Set<number>();
      taken.add(seat);
      sites.set(site, taken);
    }
  }
  return sites;
}

function sameSeats(left: ReadonlySet<number> | undefined, right: ReadonlySet<number> | undefined): boolean {
  return left !== undefined && right !== undefined && left.size === right.size && [...left].every((seat) => right.has(seat));
}

/**
 * The selected suite grouped by how far the change travelled, so a loop can run
 * the near end first.
 *
 * A change to a base component invalidates most of a suite, and that answer is
 * correct and useless: ninety per cent of the files is not a shorter run, it is
 * the same run with a report attached. What makes it useful is that the ninety
 * per cent is not flat. The tests of the edited module are one hop from it, the
 * tests of its callers are two, and the rest are further — and the near ones
 * fail *first and for the simplest reason*.
 *
 * ## The range is hops, not positions
 *
 * {@link atDistance} takes the hop counts a caller means: `0-2` is *every test
 * no more than two imports from the change*, and it is the same question
 * whatever the reading turned out to hold. A reading whose nearest test is five
 * hops away answers `0-2` with nothing, which is the true answer — no test is
 * that close — and the caller runs `3-` next and gets all of them.
 *
 * Legs start at `0` rather than `1` because zero is a distance and a common one:
 * a test whose own source the change touched is at no distance from it. A loop
 * spelled `1-2` would leave the tests of the file being edited to the last leg,
 * which is the exact opposite of what it was written for.
 *
 * Numbering the groups instead and asking for *the first two of them* would make
 * the same flag mean a different amount of work in two checkouts, and would make
 * the number in a report ({@link groupByDistance}) a different quantity from the
 * number in the command that produced it.
 *
 * ## A leg is not a gate, and the report has to say so
 *
 * Every narrowing here is already a smaller claim than the suite, and a leg is a
 * smaller claim than the narrowing. A green `0-2` says the nearest tests pass; it
 * says nothing at all about four hops, and a caller that reports it as a pass has
 * reported a pass over work nothing ran. So {@link groupByDistance} returns every
 * group whether or not the caller asked for it, {@link remaining} names what a
 * leg left behind, and the honest sentence — *this is the loop, `yarn test` is
 * the gate* — is the caller's to print.
 *
 * ## Where a test nobody could place goes
 *
 * A test with no measured distance is {@link DistanceGroup.unplaced}: no executed
 * path from the change reached it, or there was no graph to walk. It is not
 * distance zero, which is *the change is this test's own source* and is the
 * nearest thing there is. It rides with the leg that reaches the end — the one
 * whose `to` is open, or is at least the furthest distance measured — so
 * `0-2` then `3-` runs every selected file exactly once, and no leg short of the
 * end is made expensive by everything nobody could place.
 */

import type { TestDistance } from './distance.js';

/** Every test the change reached in `hops` hops. */
export interface DistanceGroup {
  /** Import hops from the change. Absent on the one group whose tests nobody placed. */
  readonly hops?: number;
  readonly tests: readonly string[];
  /** True on the group holding tests with no measured distance. */
  readonly unplaced: boolean;
}

/**
 * A distance reading as one group per hop count, nearest first, unplaced last.
 *
 * The hop counts that occur and no others: a reading with tests at one and four
 * hops has two groups, not four. This is what a report prints; it is not what
 * {@link atDistance} ranges over, which is the hop counts themselves.
 */
export function groupByDistance(distances: readonly TestDistance[]): readonly DistanceGroup[] {
  const byHops = new Map<number, string[]>();
  const unplaced: string[] = [];
  for (const distance of distances) {
    if (distance.hops === undefined) unplaced.push(distance.test);
    else byHops.set(distance.hops, [...(byHops.get(distance.hops) ?? []), distance.test]);
  }

  const groups: DistanceGroup[] = [...byHops.keys()]
    .sort((left, right) => left - right)
    .map((hops) => ({ hops, tests: [...byHops.get(hops)!].sort(codeUnitOrder), unplaced: false }));
  if (unplaced.length > 0) {
    groups.push({ tests: [...unplaced].sort(codeUnitOrder), unplaced: true });
  }
  return groups;
}

/**
 * The test files `from` through `to` hops from the change, inclusive.
 *
 * The unplaced ride with the leg that reaches the end, and with no other, so a
 * caller running `0-2` and then `3-` runs every file exactly once.
 */
export function atDistance(
  distances: readonly TestDistance[],
  from: number,
  to: number,
): readonly string[] {
  const placed = distances.filter(
    (distance) => distance.hops !== undefined && distance.hops >= from && distance.hops <= to,
  );
  const carried = reachesTheEnd(distances, to)
    ? distances.filter((distance) => distance.hops === undefined)
    : [];
  return [...new Set([...placed, ...carried].map(({ test }) => test))].sort(codeUnitOrder);
}

/**
 * What a leg did not run, so the caller can say it out loud.
 *
 * Returned rather than counted, because *26 files were not run* is a number and
 * *these 26 files were not run* is the thing somebody hands to CI.
 */
export function remaining(
  distances: readonly TestDistance[],
  from: number,
  to: number,
): readonly string[] {
  const ran = new Set(atDistance(distances, from, to));
  return [...new Set(distances.map(({ test }) => test))]
    .filter((test) => !ran.has(test))
    .sort(codeUnitOrder);
}

/**
 * Read `0-2`, `2`, or `3-` as a range of hop counts.
 *
 * `3-` is *three hops and beyond*, which is what the last leg of a loop asks for
 * and cannot spell as a number it knows in advance. `undefined` for anything
 * else, so a caller reports the typo rather than silently running one distance.
 */
export function distanceRange(
  text: string,
): { readonly from: number; readonly to: number } | undefined {
  const parsed = /^(\d+)(?:-(\d*))?$/.exec(text.trim());
  if (parsed === null) return undefined;
  const from = Number(parsed[1]);
  if (parsed[2] === undefined) return { from, to: from };
  const to = parsed[2] === '' ? Number.MAX_SAFE_INTEGER : Number(parsed[2]);
  return to < from ? undefined : { from, to };
}

/**
 * Whether a range's far edge is past everything the reading placed.
 *
 * An open `3-` always is. A closed `1-4` is when nothing was measured beyond
 * four hops. A reading that placed nothing at all is the case worth being
 * careful about: every test in it is unplaced, and only an open range carries
 * them, so a loop of closed legs leaves them to {@link remaining} rather than
 * running them twice.
 */
function reachesTheEnd(distances: readonly TestDistance[], to: number): boolean {
  let furthest = -1;
  for (const { hops } of distances) if (hops !== undefined && hops > furthest) furthest = hops;
  return furthest === -1 ? to >= Number.MAX_SAFE_INTEGER : to >= furthest;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

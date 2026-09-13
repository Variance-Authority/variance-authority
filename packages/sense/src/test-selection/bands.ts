/**
 * The selected suite cut into rings, so a loop can run the near end first.
 *
 * A change to a base component invalidates most of a suite, and that answer is
 * correct and useless: ninety per cent of the files is not a shorter run, it is
 * the same run with a report attached. What makes it useful is that the ninety
 * per cent is not flat. The tests of the edited module are one hop from it, the
 * tests of its callers are two, and the rest are further — and the near ones
 * fail *first and for the simplest reason*. Running them in that order is the
 * difference between learning the edit was wrong in six seconds and learning it
 * in eleven minutes.
 *
 * ## A band is not a gate, and the report has to say so
 *
 * Every narrowing here is already a smaller claim than the suite, and a band is
 * a smaller claim than the narrowing. A green band one says the nearest tests
 * pass; it says nothing at all about band four, and a caller that reports it as
 * a pass has reported a pass over work nothing ran. So {@link bandsOf} returns
 * every band whether or not the caller asked for it, {@link tail} names what a
 * slice left behind, and the honest sentence — *this is the loop, `yarn test` is
 * the gate* — is the caller's to print.
 *
 * ## Where a test nobody could place goes
 *
 * A test with no measured distance is {@link Band.unplaced}: no executed path
 * from the change reached it, or there was no graph to walk. It is not band
 * zero, which is *the change is this test's own source* and is the nearest thing
 * there is — it is the **last** band, and it is an ordinary band in every other
 * respect.
 *
 * Last because the first band has one job: be the cheapest run that could
 * disprove the edit. A change to a base component in a repository whose graph
 * only partly describes its own build can leave more tests unplaced than placed,
 * and a first band carrying all of them is the whole suite wearing a smaller
 * number. Riding at the back, they are picked up by the leg that reaches the end
 * — which every loop written as `1-3` then `4-` already does — and named by
 * {@link tail} until then.
 */

import type { TestDistance } from './distance.js';

/** One ring of the selected suite: every test the change reached in `hops` hops. */
export interface Band {
  /** Import hops from the change. Absent on the one band whose tests nobody placed. */
  readonly hops?: number;
  readonly tests: readonly string[];
  /** True on the band holding tests with no measured distance. */
  readonly unplaced: boolean;
}

/**
 * Cut a distance reading into bands, nearest first, unplaced last.
 *
 * Bands are the hop counts that occur, not a range: a reading with tests at one
 * and four hops and none between has two bands, and a caller asking for *the
 * first three* gets both. Numbering the empty ring in the middle would make
 * `--band 1-3` mean a different amount of work in two checkouts of the same
 * repository, which is the one thing a caller building a loop out of this cannot
 * have.
 */
export function bandsOf(distances: readonly TestDistance[]): readonly Band[] {
  const byHops = new Map<number, string[]>();
  const unplaced: string[] = [];
  for (const distance of distances) {
    if (distance.hops === undefined) unplaced.push(distance.test);
    else byHops.set(distance.hops, [...(byHops.get(distance.hops) ?? []), distance.test]);
  }

  const bands: Band[] = [...byHops.keys()]
    .sort((left, right) => left - right)
    .map((hops) => ({ hops, tests: [...byHops.get(hops)!].sort(codeUnitOrder), unplaced: false }));
  if (unplaced.length > 0) bands.push({ tests: [...unplaced].sort(codeUnitOrder), unplaced: true });
  return bands;
}

/**
 * The test files in bands `from` through `to`, one-based and inclusive.
 *
 * One-based because the first band is the first band, whatever its hop count.
 * The alternative is asking a caller to name hop numbers, and hop numbers are a
 * property of the change: `--band 1-3` after editing a leaf means something
 * different from `--band 1-3` after editing a barrel, and a loop written once
 * has to survive both.
 *
 * The unplaced band is the last one and is sliced like any other, so a range
 * that reaches the end carries it and no range short of the end does. Nothing is
 * special-cased: a caller running `1-3` and then `4-` runs every file exactly
 * once, which is the property the whole flag exists for.
 */
export function slice(bands: readonly Band[], from: number, to: number): readonly string[] {
  const taken = bands.filter((_band, at) => at + 1 >= from && at + 1 <= to);
  return [...new Set(taken.flatMap((band) => band.tests))].sort(codeUnitOrder);
}

/**
 * What a slice did not run, so the caller can say it out loud.
 *
 * Returned rather than counted, because *26 files were not run* is a number and
 * *these 26 files were not run* is the thing somebody hands to CI.
 */
export function tail(bands: readonly Band[], from: number, to: number): readonly string[] {
  const ran = new Set(slice(bands, from, to));
  return [...new Set(bands.flatMap((band) => band.tests))].filter((test) => !ran.has(test)).sort(codeUnitOrder);
}

/**
 * Read `1-3`, `2`, or `3-` as a band range.
 *
 * `3-` is *the third band onwards*, which is what the last leg of a loop asks
 * for and cannot spell as a number it knows in advance. `undefined` for anything
 * else, so a caller reports the typo rather than silently running one band.
 */
export function bandRange(text: string): { readonly from: number; readonly to: number } | undefined {
  const parsed = /^(\d+)(?:-(\d*))?$/.exec(text.trim());
  if (parsed === null) return undefined;
  const from = Number(parsed[1]);
  if (from < 1) return undefined;
  if (parsed[2] === undefined) return { from, to: from };
  const to = parsed[2] === '' ? Number.MAX_SAFE_INTEGER : Number(parsed[2]);
  return to < from ? undefined : { from, to };
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

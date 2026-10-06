/**
 * `variance select --at-distance`: one leg of the selection, still a skip list.
 *
 * A leg is the part of the selection a given number of import hops from the
 * change. It is the cut `test:since --at-distance` runs, made by the same
 * `atDistance` over the same reading, so `vitest run $(variance select
 * --at-distance 0-2 --format vitest)` runs what that leg runs. What the leg
 * leaves out is added to the skip list. Nothing else changes, so the four ways
 * {@link skippableTests} declines to narrow still decline here: a selection
 * that declines to narrow skips nothing, whichever leg was asked (ADR-0062).
 *
 * ## A leg is opt-in, and it says what it left
 *
 * Every leg is a smaller claim than the selection. A green `0-2` says nothing
 * about the test four hops out. So the leg is never the default, `json` gives
 * the files it left in `left`, and stderr gives their count and the flag that
 * runs them.
 *
 * ## A test the change did not enter and the record never saw whole runs in every leg
 *
 * `test:since` knows the suite, so a test the record never saw whole — new
 * since the recording, or recorded incomplete — goes with the other unplaced
 * tests into the leg that reaches the end. `select` reads no suite, and the
 * narrowing names only the tests seen whole or entered, so such a test is in
 * no skip list and runs in every leg. A test the change entered is placed by
 * its hops whether or not the record saw it whole. That is the safe side of a skip list: it
 * costs a file run twice, never a file run zero times.
 */

import { remaining, type TestDistance } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { many } from './reach.js';
import type { SelectInput, TestSelection } from './select.js';

/** The hops `--at-distance` asked for. An open end is `Number.MAX_SAFE_INTEGER`, as `distanceRange` reads it. */
export interface Leg {
  readonly from: number;
  readonly to: number;
}

/**
 * Cut a selection down to one leg.
 *
 * The leg's skip list is the selection's, plus every entered test outside the
 * leg. A widened selection stays empty and names the leg anyway, so a loop
 * reading `json` sees which leg it asked for and that nothing was left.
 */
export function inLeg(selection: TestSelection, input: SelectInput, leg: Leg | undefined): TestSelection {
  if (leg === undefined) return selection;
  if (input.given === true) {
    throw new OperatorError(
      '`--at-distance` cuts the selection by import hops, and a journey file records no imports to count them by. ' +
        'Run without `--at-distance`, or select from the recorded suite.',
    );
  }
  const asked = { leg: legOf(leg) };
  const range = spelled(leg);
  if (selection.widened !== undefined || input.ground.kind !== 'read') {
    return {
      ...selection,
      ...asked,
      left: [],
      notes: [`\`--at-distance ${range}\` runs every test file: nothing was narrowed`, ...selection.notes],
    };
  }

  const { entered } = input.ground.narrowing;
  const placed = new Map((input.ground.distances ?? []).map((distance) => [distance.test, distance]));
  // An entered test with no measured distance is unplaced, as `test:since` reads one.
  const reading: readonly TestDistance[] = entered.map((test) => placed.get(test) ?? { test, bearing: 'unexplained' });
  const left = remaining(reading, leg.from, leg.to);
  const skip = [...new Set([...selection.skip, ...left])].sort(codeUnitOrder);
  const nearer = left.filter((test) => (placed.get(test)?.hops ?? Number.MAX_SAFE_INTEGER) < leg.from);
  const further = left.length - nearer.length;
  const whole = selection.recorded?.whole ?? 0;

  return {
    ...selection,
    ...asked,
    skip,
    left,
    // `left` can hold an entered test the record never saw whole, so the two
    // counts are named apart rather than as a share of the whole.
    because:
      `skipping ${many(skip.length, 'test file')}: ${selection.skip.length} of ${whole} recorded whole ` +
      `covered no changed line, and ${left.length} ${left.length === 1 ? 'is' : 'are'} outside \`--at-distance ${range}\`; ` +
      'every other test file runs',
    notes: [
      ...leftNote(further, 'for a later leg', `${leg.to + 1}-`),
      ...leftNote(nearer.length, `for an earlier leg, nearer than ${many(leg.from, 'hop')}`, spelled({ from: 0, to: leg.from - 1 })),
      ...selection.notes,
    ],
  };
}

/** How many selected files this leg left, and the leg that runs them. */
function leftNote(count: number, where: string, range: string): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'selected test file')} ${count === 1 ? 'is' : 'are'} left ${where}: ` +
      `the same command with \`--at-distance ${range}\` runs ${count === 1 ? 'it' : 'them'}`,
  ];
}

/** The leg as `json` gives it: an open end is absent rather than a sentinel number. */
function legOf(leg: Leg): { readonly from: number; readonly to?: number } {
  return leg.to === Number.MAX_SAFE_INTEGER ? { from: leg.from } : { from: leg.from, to: leg.to };
}

/** The leg as it was typed. */
function spelled(leg: Leg): string {
  if (leg.to === Number.MAX_SAFE_INTEGER) return `${leg.from}-`;
  return leg.to === leg.from ? `${leg.from}` : `${leg.from}-${leg.to}`;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

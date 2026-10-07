/**
 * `variance select --at-distance`: one leg of the selection, still a skip list.
 *
 * A leg is the part of the selection a given number of import hops from the
 * change. It is the cut a seam runs under `VARIANCE_AUTHORITY_AT_DISTANCE`,
 * made by the same `atDistance` over the same reading, through `selectSuite`. What the leg
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
 * ## Where an unplaced test runs
 *
 * The *open leg* is the one with no upper bound, such as `3-`. The *end leg* is
 * the open leg, or a closed leg reaching the furthest hop the reading measured:
 * `0-2` is an end leg when something is placed and nothing past 2; with nothing
 * placed, only the open leg is. An entered test with no hop count runs in the
 * end leg, as `atDistance` carries it.
 *
 * A test the record holds incomplete, such as a file a partial run demoted, or
 * one whose every case skipped, may call the change from a case the record did
 * not see. When the change entered it, it is placed by its hops like any other.
 * When it did not, sense places it by the shortest path it executed to a
 * changed file it loaded (`distanceFromView` names which changed files count),
 * and it runs in the leg those hops fall in. With no hop count it is unplaced,
 * and runs in the open leg only: it is on the skip list of every closed leg. A
 * placed one counts toward the furthest hop, so it decides which closed leg is
 * an end leg. A test new since the recording is named nowhere, so it is in no
 * skip list and runs in every leg. That is the safe side of a skip list: it
 * costs a file run twice, never a file run zero times.
 *
 * ## The reading a leg was cut from is said with it
 *
 * A leg is chosen by hop counts, so the counts it was chosen from are given
 * beside it: stderr counts the entered tests at each distance, and `json` gives
 * each one's distance as sense measured it, its bearing and, for one it could
 * not place, the reason. A test the change entered by no import it executed is
 * the one a reader expects in the near leg and finds in the end leg.
 */

import { groupByDistance, remaining, type TestDistance } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { many } from './prose-counts.js';
import type { SelectInput, TestSelection } from './select.js';

/** The hops `--at-distance` asked for. An open end is `Number.MAX_SAFE_INTEGER`, as `distanceRange` reads it. */
export interface Leg {
  readonly from: number;
  readonly to: number;
}

/**
 * Cut a selection down to one leg.
 *
 * The leg's skip list is the selection's, plus every entered or incomplete
 * test outside the leg. A widened selection stays empty and names the leg
 * anyway, so a loop reading `json` sees which leg it asked for and that nothing
 * was left.
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
  // An entered test with no measured distance is unplaced.
  const reading: readonly TestDistance[] = entered
    .map((test): TestDistance => placed.get(test) ?? { test, bearing: 'unexplained' })
    .sort((one, other) => codeUnitOrder(one.test, other.test));
  // Named only by the record, which never saw them whole: placed by the hops
  // they executed to a changed file when sense measured them, and otherwise run
  // by the open leg alone. A distance with no hops places nothing.
  const entering = new Set(entered);
  const partial = (input.ground.narrowing.incomplete ?? []).filter((test) => !entering.has(test));
  const hopped = partial.flatMap((test) => {
    const distance = placed.get(test);
    return distance?.hops === undefined ? [] : [distance];
  });
  const measured = [...reading, ...hopped].sort((one, other) => codeUnitOrder(one.test, other.test));
  const cut = remaining(measured, leg.from, leg.to);
  const leaving = new Set(cut);
  const placedHere = hopped.filter(({ test }) => !leaving.has(test)).length;
  const placedPartial = new Set(hopped.map(({ test }) => test));
  const unseen = leg.to === Number.MAX_SAFE_INTEGER ? [] : partial.filter((test) => !placedPartial.has(test));
  const outside = [...cut, ...unseen].sort(codeUnitOrder);
  const skip = [...new Set([...selection.skip, ...outside])].sort(codeUnitOrder);
  const nearer = cut.filter((test) => (placed.get(test)?.hops ?? Number.MAX_SAFE_INTEGER) < leg.from);
  const further = cut.length - nearer.length;
  const whole = selection.recorded?.whole ?? 0;

  return {
    ...selection,
    ...asked,
    skip,
    left: outside,
    distances: measured,
    // `left` can hold an entered test the record never saw whole, so the two
    // counts are named apart rather than as a share of the whole.
    because:
      `skipping ${many(skip.length, 'test file')}: ${selection.skip.length} of ${whole} recorded whole ` +
      `covered no changed line, and ${outside.length} ${outside.length === 1 ? 'is' : 'are'} outside \`--at-distance ${range}\`; ` +
      'every other test file runs',
    notes: [
      ...byDistance(reading),
      ...placedNote(placedHere),
      ...leftNote(further, 'for a later leg', `${leg.to + 1}-`),
      ...unseenNote(unseen.length, `${leg.to + 1}-`),
      ...leftNote(nearer.length, `for an earlier leg, nearer than ${many(leg.from, 'hop')}`, spelled({ from: 0, to: leg.from - 1 })),
      ...selection.notes,
    ],
  };
}

/** How many entered tests sit at each distance, nearest first, the unplaced last. */
function byDistance(reading: readonly TestDistance[]): readonly string[] {
  if (reading.length === 0) return [];
  const counts = groupByDistance(reading).map((group) =>
    group.unplaced
      ? `${group.tests.length} at no measured distance, which ${group.tests.length === 1 ? 'runs' : 'run'} in the end leg`
      : `${group.tests.length} at ${many(group.hops ?? 0, 'hop')}`,
  );
  const listed = counts.length === 1 ? counts[0] : `${counts.slice(0, -1).join(', ')}, and ${counts.at(-1)}`;
  return [`the change entered ${many(reading.length, 'test file')}: ${listed}`];
}

/**
 * How many tests the record never saw whole this leg runs by the path they ran
 * to the change. Said once, by the leg that runs them.
 */
function placedNote(count: number): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'test file')} the record never saw whole and the change did not enter ` +
      `${count === 1 ? 'is' : 'are'} placed in this leg by the hops ${count === 1 ? 'it' : 'they'} ran to a changed file`,
  ];
}

/** How many selected files this leg left, and the leg that runs them. */
function leftNote(count: number, where: string, range: string): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'selected test file')} ${count === 1 ? 'is' : 'are'} left ${where}: ` +
      `the same command with \`--at-distance ${range}\` runs ${count === 1 ? 'it' : 'them'}`,
  ];
}

/** How many unplaced tests the record never saw whole this leg left, for the open leg. */
function unseenNote(count: number, range: string): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'test file')} the record never saw whole and the change did not enter ` +
      `${count === 1 ? 'is' : 'are'} left for the open leg: ` +
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

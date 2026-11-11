/**
 * `variance select --at-distance`: one leg of the selection, still a skip list.
 *
 * A leg is the part of the selection a given number of import hops from the
 * change: the cut a seam runs under `VARIANCE_AUTHORITY_AT_DISTANCE`, made by
 * `atDistance` over the reading `selectSuite` made. What the leg leaves out is
 * added to the skip list, and nothing else changes: a selection that declines
 * to narrow skips nothing, whichever leg was asked (ADR-0062).
 */

import { atDistance, distanceRange, groupByDistance, remaining, type TestDistance } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { many } from './prose-counts.js';
import type { SelectInput, TestSelection } from './select.js';

/**
 * Read `--at-distance`, or say what it should have been.
 *
 * The same spelling `atDistance` ranges over — `0-3`, `2`, `3-` — because the
 * flag is named after the quantity and the quantity is hop counts. A typo is
 * refused rather than read as one distance: `0-e` narrowing silently to zero
 * hops would answer *nothing is near* about a line six tests reach. Read here
 * rather than by the parser, so only the commands that take the flag load the
 * selection library that owns the spelling.
 */
export function parseAtDistance(raw: string | undefined): { readonly from: number; readonly to: number } | undefined {
  if (raw === undefined) return undefined;
  const range = distanceRange(raw);
  if (range === undefined) {
    throw new OperatorError(
      `--at-distance takes hop counts — \`0-3\`, \`2\`, or \`3-\` for three and beyond — not ` +
        `\`${raw}\`.`,
    );
  }
  return range;
}

/** The hops `--at-distance` asked for. An open end is `Number.MAX_SAFE_INTEGER`, as `distanceRange` reads it. */
export interface Leg {
  readonly from: number;
  readonly to: number;
  /**
   * Where the leg was asked: `environment` when a seam read it from
   * `VARIANCE_AUTHORITY_AT_DISTANCE`, so the notes name that variable rather
   * than a flag the run has no command line for. The `--at-distance` flag when absent.
   */
  readonly by?: 'environment';
  /**
   * The legs are the waves of one shard, which read one record: a leg that
   * starts past 0 hops runs only what the record placed in it, so no file runs
   * in two waves (`TestSelection.only`).
   */
  readonly partition?: true;
}

/**
 * Cut a selection down to one leg.
 *
 * The leg's skip list is the selection's, plus every entered or incomplete
 * test outside the leg. A leg is a smaller claim than the selection, so it is
 * never the default, and it says what it left: `json` in `left`, stderr by
 * count with the flag that runs them. A widened selection stays empty and
 * names the leg anyway. A test new since the recording is in no skip list and
 * runs in every leg — a file run twice, never zero times — except under
 * `partition` (see `later`).
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
  if (selection.fell !== undefined) {
    const why = 'hops are counted only on a record that narrowed';
    if (later(leg)) return nearest(selection, leg, range, why);
    return { ...selection, ...asked, left: [], notes: [`${asking(leg, range)} runs every test file \`--local\` selected: ${why}`, ...selection.notes] };
  }
  if (selection.widened !== undefined || input.ground.kind !== 'read') {
    if (later(leg)) return nearest(selection, leg, range, 'nothing was narrowed');
    return {
      ...selection,
      ...asked,
      left: [],
      notes: [`${asking(leg, range)} runs every test file: nothing was narrowed`, ...selection.notes],
    };
  }

  // Hops read off edges the checkout may no longer hold place no test: every
  // leg runs what the selection runs.
  if (input.ground.stale !== undefined) {
    if (later(leg)) return nearest(selection, leg, range, `the hops are measured on a graph that is not the checkout's, because ${input.ground.stale}`);
    return {
      ...selection,
      ...asked,
      left: [],
      notes: [
        `${asking(leg, range)} runs every selected test file: the hops are measured on a graph that is not the checkout's, because ${input.ground.stale}`,
        ...selection.notes,
      ],
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
  // by the open leg alone. An entered test with no hops runs in the end leg, the
  // one holding the furthest hop measured, or the open leg when none is.
  const entering = new Set(entered);
  const partial = (input.ground.narrowing.incomplete ?? []).filter((test) => !entering.has(test));
  const hopped = partial.flatMap((test) => {
    const distance = placed.get(test);
    return distance?.hops === undefined ? [] : [distance];
  });
  const measured = [...reading, ...hopped].sort((one, other) => codeUnitOrder(one.test, other.test));
  // Each leg lands before the next is cut, so a later leg's reading can enter a
  // test nearer than its first hop that no earlier leg ran: one still standing
  // before HEAD is overdue, and this leg runs it. The waves of one shard read
  // the record they were handed, so under `partition` nothing is overdue.
  const before = new Set(leg.from === 0 ? [] : atDistance(measured, 0, leg.from - 1));
  const unrun = new Set(leg.partition === true ? [] : (input.ground.unrunAtHead ?? []));
  const elsewhere = remaining(measured, leg.from, leg.to);
  const overdue = elsewhere.filter((test) => before.has(test) && unrun.has(test));
  const taking = new Set(overdue);
  const cut = elsewhere.filter((test) => !taking.has(test));
  const leaving = new Set(cut);
  const placedHere = hopped.filter(({ test }) => !leaving.has(test)).length;
  const placedPartial = new Set(hopped.map(({ test }) => test));
  const unseen = leg.to === Number.MAX_SAFE_INTEGER ? [] : partial.filter((test) => !placedPartial.has(test));
  const outside = [...cut, ...unseen].sort(codeUnitOrder);
  const skip = [...new Set([...selection.skip, ...outside])].sort(codeUnitOrder);
  const skipping = new Set(skip);
  const { whole: recorded, incomplete = [] } = input.ground.narrowing;
  const only = later(leg) ? [...new Set([...recorded, ...incomplete, ...entered])].filter((test) => !skipping.has(test)).sort(codeUnitOrder) : undefined;
  const nearer = cut.filter((test) => before.has(test));
  const further = cut.length - nearer.length;
  const whole = selection.recorded?.whole ?? 0;

  return {
    ...selection,
    ...asked,
    skip,
    left: outside,
    ...(only === undefined ? {} : { only }),
    distances: measured,
    // `left` can hold an entered test the record never saw whole, so the two
    // counts are named apart rather than as a share of the whole.
    because:
      `skipping ${many(skip.length, 'test file')}: ${selection.skip.length} of ${whole} recorded whole ` +
      `covered no changed line, and ${outside.length} ${outside.length === 1 ? 'is' : 'are'} outside ${asking(leg, range)}; ` +
      'every other test file runs',
    notes: [
      ...byDistance(reading, measured),
      ...placedNote(placedHere),
      ...leftNote(further, 'for a later leg', again(leg, `${leg.to + 1}-`)),
      ...unseenNote(unseen.length, again(leg, `${leg.to + 1}-`)),
      ...leftNote(
        nearer.length,
        `for an earlier leg, nearer than ${many(leg.from, 'hop')}`,
        again(leg, spelled({ from: 0, to: leg.from - 1 })),
      ),
      ...overdueNote(overdue.length),
      ...selection.notes,
    ],
  };
}

/**
 * A wave of one shard that starts past 0 hops. A shard places each wave's
 * files among the shards by their times, so a file two waves ran could land in
 * two shards' records. Such a wave runs only what the record placed in its
 * range: a new test, and every file of a reading that could not narrow, run in
 * the wave that starts at 0 hops alone.
 */
function later(leg: Leg): boolean {
  return leg.partition === true && leg.from > 0;
}

/** A later wave of a reading that placed nothing: it runs no file, and the wave that starts at 0 hops runs every one. */
function nearest(selection: TestSelection, leg: Leg, range: string, why: string): TestSelection {
  return {
    ...selection,
    leg: legOf(leg),
    left: [],
    only: [],
    notes: [`${asking(leg, range)} runs no test file: ${why}, so the leg that starts at 0 hops runs every one`, ...selection.notes],
  };
}

/**
 * How many entered tests sit at each distance, nearest first, the unplaced last:
 * a leg is chosen by hop counts, so the counts it was chosen from are said with it.
 *
 * `measured` is the reading the leg was cut from, which also holds the
 * incomplete tests placed by their hops: one of those can hold the furthest
 * hop, and so decide the end leg.
 */
function byDistance(reading: readonly TestDistance[], measured: readonly TestDistance[]): readonly string[] {
  if (reading.length === 0) return [];
  const groups = groupByDistance(reading);
  // `atDistance` owns where the unplaced run: ask it which measured hop's leg
  // returns one, and when none does, they run in the open leg.
  const unplaced = groups.find((group) => group.unplaced)?.tests[0];
  const carrier =
    unplaced === undefined
      ? undefined
      : groupByDistance(measured).find(
          (group) => group.hops !== undefined && atDistance(measured, group.hops, group.hops).includes(unplaced),
        )?.hops;
  const runs = carrier === undefined ? 'in the open leg' : `in the leg that holds ${many(carrier, 'hop')}, the furthest measured`;
  const counts = groups.map((group) =>
    group.unplaced
      ? `${group.tests.length} at no measured distance, which ${group.tests.length === 1 ? 'runs' : 'run'} ${runs}`
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
function leftNote(count: number, where: string, rerun: string): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'selected test file')} ${count === 1 ? 'is' : 'are'} left ${where}: ` +
      `${rerun} runs ${count === 1 ? 'it' : 'them'}`,
  ];
}

/** How many unplaced tests the record never saw whole this leg left, for the open leg. */
function unseenNote(count: number, rerun: string): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'test file')} the record never saw whole and the change did not enter ` +
      `${count === 1 ? 'is' : 'are'} left for the open leg: ` +
      `${rerun} runs ${count === 1 ? 'it' : 'them'}`,
  ];
}

/** How many tests an earlier leg holds this leg runs, because the run landed at HEAD left them standing. */
function overdueNote(count: number): readonly string[] {
  if (count === 0) return [];
  return [
    `${many(count, 'selected test file')} of an earlier leg ${count === 1 ? 'runs' : 'run'} in this leg: ` +
      `${count === 1 ? 'it' : 'they'} last ran before HEAD, and the run that landed at HEAD did not run ${count === 1 ? 'it' : 'them'}`,
  ];
}

/** The leg as `json` gives it: an open end is absent rather than a sentinel number. */
function legOf(leg: Leg): { readonly from: number; readonly to?: number } {
  return leg.to === Number.MAX_SAFE_INTEGER ? { from: leg.from } : { from: leg.from, to: leg.to };
}

/** The leg named as it was asked: the variable a seam read, or the flag. */
function asking(leg: Leg, range: string): string {
  return leg.by === 'environment' ? `\`VARIANCE_AUTHORITY_AT_DISTANCE=${range}\`` : `\`--at-distance ${range}\``;
}

/** What asks for another leg the way this one was asked. */
function again(leg: Leg, range: string): string {
  return leg.by === 'environment' ? `the same run with ${asking(leg, range)}` : `the same command with ${asking(leg, range)}`;
}

/** The leg as it was typed. */
function spelled(leg: Leg): string {
  if (leg.to === Number.MAX_SAFE_INTEGER) return `${leg.from}-`;
  return leg.to === leg.from ? `${leg.from}` : `${leg.from}-${leg.to}`;
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

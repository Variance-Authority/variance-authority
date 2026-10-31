import { describe, expect, it } from 'vitest';
import { journeysLine } from './index-command.js';

/**
 * The journeys line of `variance index`, from a walk's own counts: what share
 * of the functions the recorded cases entered has a caller, each count in the
 * one unit it is counted in. A function two cases entered is entered twice, so
 * the share is over entries, and the line says so; calls and package flows are
 * distinct over all the cases.
 */

const walk = {
  kept: false,
  cases: 12,
  functionsEntered: 40,
  placed: 30,
  calls: 55,
  flows: 3,
  fellBack: 0,
} as const;

describe('the journeys line', () => {
  it('names the unit of every count: entries counted once per case, distinct calls and distinct package flows', () => {
    expect(journeysLine({ out: 'journeys.bin', prepared: walk })).toBe(
      'journeys: 12 cases walked; a caller is placed for 30 of the 40 functions the cases entered, counted once per case that entered each (75%); ' +
        '55 distinct calls, 3 distinct package flows',
    );
  });

  it('counts one case, one call and one flow in the singular, and the specifiers the walk resolved itself', () => {
    expect(journeysLine({ suite: 'unit', out: 'journeys.unit.bin', prepared: { ...walk, cases: 1, functionsEntered: 1, placed: 1, calls: 1, flows: 1, fellBack: 2 } })).toBe(
      'journeys, suite unit: 1 case walked; a caller is placed for 1 of the 1 functions the cases entered, counted once per case that entered each (100%); ' +
        '1 distinct call, 1 distinct package flow; 2 import specifiers the index did not resolve were resolved by the walk',
    );
  });
});

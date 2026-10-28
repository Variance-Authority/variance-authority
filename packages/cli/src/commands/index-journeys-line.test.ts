import { describe, expect, it } from 'vitest';
import { journeysLine } from './index-command.js';

/**
 * The journeys line of `variance index`, from a walk's own counts: what share
 * of the functions the recorded cases ran has a caller, and how many calls the
 * walk placed from the recording or left without a place.
 */

const walk = {
  kept: false,
  cases: 12,
  functionsEntered: 40,
  placed: 30,
  calls: 55,
  flows: 3,
  fellBack: 0,
  recorded: 0,
  ambiguous: 0,
  ambiguousCases: 0,
} as const;

describe('the journeys line', () => {
  it('says how many functions the cases ran have a caller, and adds nothing when every import resolved from the source', () => {
    expect(journeysLine({ out: 'journeys.bin', prepared: walk })).toBe(
      'journeys: 12 cases walked; a caller is found for 30 of the 40 functions they ran (75%); 55 calls, 3 package flows',
    );
  });

  it('counts the calls placed from the recording, and the calls left without a place in how many cases', () => {
    expect(journeysLine({ suite: 'unit', out: 'journeys.unit.bin', prepared: { ...walk, recorded: 4, ambiguous: 2, ambiguousCases: 5 } })).toBe(
      'journeys, suite unit: 12 cases walked; a caller is found for 30 of the 40 functions they ran (75%); 55 calls, 3 package flows; ' +
        '4 calls were placed from the recording, because their import resolved to no function and exactly one the case ran is exported under the imported name; ' +
        '2 calls have no place, because their import resolved to no function and several the case ran are exported under the imported name, in 5 cases',
    );
  });

  it('says a single case when the calls without a place were all in one', () => {
    expect(journeysLine({ out: 'journeys.bin', prepared: { ...walk, ambiguous: 1, ambiguousCases: 1 } })).toMatch(/several the case ran are exported under the imported name, in 1 case$/u);
  });
});

import { describe, expect, it } from 'vitest';
import { journeysLine } from './index-command.js';

/**
 * The journeys line of `variance index`, from a walk's own counts: what share
 * of the functions the recorded cases ran has a caller, and how the imports
 * that brought the calls there were resolved.
 */

const walk = {
  kept: false,
  cases: 12,
  functionsEntered: 40,
  placed: 30,
  calls: 55,
  flows: 3,
  fellBack: 0,
  aliased: 0,
  runnerUnread: [],
} as const;

describe('the journeys line', () => {
  it('says how many functions the cases ran have a caller, and adds nothing when every import resolved from the source', () => {
    expect(journeysLine({ out: 'journeys.bin', prepared: walk })).toBe(
      'journeys: 12 cases walked; a caller is found for 30 of the 40 functions they ran (75%); 55 calls, 3 package flows',
    );
  });

  it('counts the imports the runner\'s aliases resolved, and says which runner configs did not load and why', () => {
    expect(
      journeysLine({
        suite: 'unit',
        out: 'journeys.unit.bin',
        prepared: { ...walk, aliased: 4, runnerUnread: ['test/regressions/vitest.config.ts: did not load (__dirname is not defined)'] },
      }),
    ).toBe(
      'journeys, suite unit: 12 cases walked; a caller is found for 30 of the 40 functions they ran (75%); 55 calls, 3 package flows; ' +
        '4 imports resolved by the runner\'s aliases; test/regressions/vitest.config.ts: did not load (__dirname is not defined)',
    );
  });
});

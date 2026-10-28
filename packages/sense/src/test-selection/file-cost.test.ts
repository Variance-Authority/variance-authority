import { describe, expect, it } from 'vitest';
import { fileCost, timeBeforeCases } from './file-cost.js';
import { NO_DURATION, PHASE_NAMES } from './format-layout.js';

/** Phase words in record order, {@link NO_DURATION} for each phase not named. */
const phases = (timed: Partial<Record<(typeof PHASE_NAMES)[number], number>>): number[] =>
  PHASE_NAMES.map((name) => timed[name] ?? NO_DURATION);

describe('what a recorded test file cost', () => {
  it('is its duration when the record has no phases for it', () => {
    expect(fileCost(400, undefined)).toBe(400);
    expect(timeBeforeCases(undefined)).toBeUndefined();
  });

  it('is its phases summed when the runner gave no duration', () => {
    expect(fileCost(NO_DURATION, phases({ prepare: 100, collect: 2000, cases: 30 }))).toBe(2130);
  });

  it('is the larger of the two when the runner gave both', () => {
    // Vitest's duration is its cases alone; Jest's spans more than its phases name.
    expect(fileCost(30, phases({ prepare: 100, collect: 2000, cases: 30 }))).toBe(2130);
    expect(fileCost(5000, phases({ collect: 2000, cases: 30 }))).toBe(5000);
  });

  it('is absent when the runner timed nothing', () => {
    expect(fileCost(NO_DURATION, phases({}))).toBeUndefined();
    expect(fileCost(NO_DURATION, undefined)).toBeUndefined();
  });

  it('counts everything before cases as the time before them', () => {
    expect(timeBeforeCases(phases({ prepare: 100, environment: 900, collect: 2000, cases: 30 }))).toBe(3000);
    expect(timeBeforeCases(phases({ cases: 30 }))).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { oneRowPerFile } from './finished-files.js';
import { jestPhases, reportedDuration, reportedPhases } from './reported-time.js';

describe('the duration a runner reported for a test file', () => {
  it('is kept as reported when it is a figure a runner could mean', () => {
    expect(reportedDuration(12.5)).toEqual({ duration: 12.5 });
    expect(reportedDuration(0)).toEqual({ duration: 0 });
  });

  it('is absent, never zero, when the runner said nothing usable', () => {
    for (const said of [undefined, null, '12', -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(reportedDuration(said)).toEqual({});
    }
  });
});

describe('the duration of a file two projects both ran', () => {
  const ran = (duration?: number) => ({
    filepath: '/repo/a.test.ts',
    complete: true,
    ...(duration === undefined ? {} : { duration }),
  });

  it('is what both projects spent on it', () => {
    const [row] = oneRowPerFile([ran(10), ran(15)], '/repo');

    expect(row?.duration).toBe(25);
  });

  it('is unknown when one project did not say, rather than short', () => {
    const [row] = oneRowPerFile([ran(10), ran()], '/repo');

    expect(row).not.toHaveProperty('duration');
  });
});

describe('the phases a runner reported for a test file', () => {
  it('keeps each phase a runner could mean, and leaves out the rest', () => {
    expect(reportedPhases({ prepare: 3.5, environment: 0, setup: -1, collect: Number.NaN })).toEqual({
      phases: { prepare: 3.5, environment: 0 },
    });
  });

  it('is absent when the runner reported no phase at all', () => {
    expect(reportedPhases({})).toEqual({});
    expect(reportedPhases({ setup: undefined, collect: '9' })).toEqual({});
  });
});

describe('the phases of a file two projects both ran', () => {
  const ran = (collect?: number, setup?: number) => ({
    filepath: '/repo/a.test.ts',
    complete: true,
    ...reportedPhases({ collect, setup }),
  });

  it('are what both projects spent in each phase', () => {
    const [row] = oneRowPerFile([ran(100, 4), ran(50, 6)], '/repo');

    expect(row?.phases).toEqual({ collect: 150, setup: 10 });
  });

  it('leave a phase unknown when one project did not report it, rather than short', () => {
    const [row] = oneRowPerFile([ran(100, 4), ran(50)], '/repo');

    expect(row?.phases).toEqual({ collect: 150 });
  });
});

describe('the phases Jest reported for a test file', () => {
  const perfStats = {
    start: 1000,
    loadTestEnvironmentStart: 1002,
    loadTestEnvironmentEnd: 1032,
    setupFilesStart: 1032,
    setupFilesEnd: 1036,
    setupAfterEnvStart: 1040,
    setupAfterEnvEnd: 1045,
    end: 1700,
  };

  it('reads the environment and the setup files from `perfStats`, and splits the rest where collection ended', () => {
    expect(jestPhases(perfStats, [1600])).toEqual({ phases: { environment: 30, setup: 9, collect: 555, cases: 100 } });
  });

  it('times no collect and no cases when the file never said where collection ended, and never a prepare', () => {
    expect(jestPhases(perfStats, [])).toEqual({ phases: { environment: 30, setup: 9 } });
  });

  it('splits nothing at a mark outside the file\'s own span, rather than give one half the other\'s time', () => {
    expect(jestPhases(perfStats, [0])).toEqual({ phases: { environment: 30, setup: 9 } });
    expect(jestPhases(perfStats, [1800])).toEqual({ phases: { environment: 30, setup: 9 } });
  });

  it('splits at the one mark inside the file\'s span, where another project left its own for the same path', () => {
    expect(jestPhases(perfStats, [0, 1600])).toEqual({ phases: { environment: 30, setup: 9, collect: 555, cases: 100 } });
  });

  it('splits nothing when two marks fall inside the file\'s span, since either could be this run\'s', () => {
    expect(jestPhases(perfStats, [1600, 1650])).toEqual({ phases: { environment: 30, setup: 9 } });
  });

  it('is absent when Jest timed nothing', () => {
    expect(jestPhases(undefined, [1600])).toEqual({});
  });
});

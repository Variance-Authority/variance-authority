import { describe, expect, it } from 'vitest';
import { oneRowPerFile, reportedDuration } from './finished-files.js';

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

import { describe, expect, it } from 'vitest';
import type { ObservationRecord } from './format.js';
import { unstableOf } from './unstable.js';

const unstable: ObservationRecord = {
  subject: 'story:clock',
  verdict: 'changed',
  because: '29 pixel(s) differ across 1 region(s)',
  changedPixels: 29,
  regions: [],
  unstable: { components: [{ name: 'Clock', file: 'src/ds.jsx:118' }], bands: ['content'], because: 'two readings differ' },
};

describe('the subjects that disagreed with themselves', () => {
  it('lists an unabsorbed instability with what moved, and leaves an absorbed one out', () => {
    const absorbed: ObservationRecord = {
      ...unstable,
      subject: 'route:home',
      unstable: { ...unstable.unstable!, absorbed: { rule: 'routes', level: 'layout' } },
    };

    expect(unstableOf({ observations: [unstable, absorbed] }).subjects).toEqual([
      { subject: 'story:clock', components: [{ name: 'Clock', file: 'src/ds.jsx:118' }], bands: ['content'] },
    ]);
  });

  it('says once that no history record answered, rather than per subject', () => {
    expect(unstableOf({ observations: [unstable] }).unrecorded).toBe(true);
  });

  it('carries the history record for a subject the store knows', () => {
    const record = {
      runs: 12,
      sweeps: 12,
      occurrences: 6,
      absorbedRuns: 0,
      rate: 0.5,
      sweepsSince: 0,
      causes: [],
      because: 'read differently in 6 run(s)',
    };
    const folded = unstableOf({ observations: [unstable], flakiness: { 'story:clock': record } });

    expect(folded.unrecorded).toBe(false);
    expect(folded.subjects[0]?.record).toBe(record);
  });
});

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID } from '../instrument/index.js';
import { joinObservations, type ObservedSubject } from './observed.js';

const subject = (extra: Partial<ObservedSubject>): ObservedSubject => ({
  owner: 'price--premium',
  complete: true,
  journal: { instrumentation: INSTRUMENTATION_ID, modules: [] },
  ...extra,
});

describe('a joined subject says where its time went', () => {
  it('adds every reading that timed it, as durations are, and a source that timed nothing leaves the rest standing', () => {
    const [joined] = joinObservations([
      [subject({})],
      [subject({ phases: { prepare: 900, collect: 40, cases: 12 } })],
      [subject({ phases: { prepare: 0, collect: 5, cases: 3 } })],
    ]);
    expect(joined?.phases).toEqual({ prepare: 900, collect: 45, cases: 15 });
  });

  it('leaves a phase unknown where one reading did not time it', () => {
    const [joined] = joinObservations([
      [subject({ phases: { prepare: 900, collect: 40, cases: 12 } })],
      [subject({ phases: { collect: 5, cases: 3 } })],
    ]);
    expect(joined?.phases).toEqual({ collect: 45, cases: 15 });
  });
});

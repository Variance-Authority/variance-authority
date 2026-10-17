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
  it('keeps the first source that timed it, rather than adding a second reading to the first', () => {
    const [joined] = joinObservations([
      [subject({})],
      [subject({ phases: { prepare: 900, collect: 40, cases: 12 } })],
      [subject({ phases: { collect: 5, cases: 3 } })],
    ]);
    expect(joined?.phases).toEqual({ prepare: 900, collect: 40, cases: 12 });
  });
});

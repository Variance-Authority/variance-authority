import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrumentationId, retiredProbes } from './index.js';

describe('a record cut under probes this build no longer places', () => {
  it('names the same mode’s current probes in their place', () => {
    expect(retiredProbes('sense:instrument/presence-v5')).toEqual([INSTRUMENTATION_ID]);
    expect(retiredProbes('sense:instrument/entries-v2')).toEqual([instrumentationId('entries')]);
  });

  it('names every current recipe when the old one names no mode', () => {
    expect(retiredProbes('sense:instrument/v1')).toEqual([INSTRUMENTATION_ID, instrumentationId('entries')]);
  });

  it('calls neither a current recipe nor somebody else’s identity retired', () => {
    expect(retiredProbes(INSTRUMENTATION_ID)).toBeUndefined();
    expect(retiredProbes(instrumentationId('entries'))).toBeUndefined();
    expect(retiredProbes('fixture')).toBeUndefined();
  });
});

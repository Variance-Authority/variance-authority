import { describe, expect, it } from 'vitest';
import { probesRegions } from './identity.js';

describe('probesRegions', () => {
  it('answers that the two walks probe regions, and that no mode means presence', () => {
    expect([probesRegions('presence'), probesRegions('entries'), probesRegions(undefined)]).toEqual([true, true, true]);
  });

  it('answers that loads probes no region, so no test file is cut and no case scoped', () => {
    expect(probesRegions('loads')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { runDemo } from './demo.js';

describe('cached source selection', () => {
  it('keeps the selection answer while reusing parse and relation work', async () => {
    const result = await runDemo();

    expect(result.cold).toEqual({ affected: ['Button'], collect: ['story:catalog'], skip: ['story:account'] });
    expect(result.warm).toEqual(result.cold);
    expect(result.afterEdit).toEqual(result.cold);
    expect(result.coldMs).toBeGreaterThan(0);
    expect(result.warmMs).toBeGreaterThan(0);
    expect(result.afterEditMs).toBeGreaterThan(0);
    expect(result.work.cold.reread).toBeGreaterThan(0);
    expect(result.work.cold.parsed).toBeGreaterThan(0);
    expect(result.work.warm.files).toBe(result.work.cold.files);
    expect(result.work.warm.reread).toBe(0);
    expect(result.work.warm.parsed).toBe(0);
    expect(result.work.afterEdit.reread).toBe(1);
    expect(result.work.afterEdit.reread).toBeLessThan(result.work.afterEdit.files);
    expect(result.cacheAfterCold).toBe(true);
    expect(result.cacheMagic).toBe('VAIDXLSM');
    expect(result.cacheSegments).toBeGreaterThan(0);
  }, 120_000);
});

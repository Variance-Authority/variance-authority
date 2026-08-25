import { describe, expect, it } from 'vitest';
import { runDemo } from './demo.js';

describe('cached source selection', () => {
  it('keeps the selection answer while reusing parse and relation work', async () => {
    const result = await runDemo();

    expect(result.cold).toEqual({ reached: ['Button'], collect: ['story:catalog'], skip: ['story:account'] });
    expect(result.warm).toEqual(result.cold);
    expect(result.afterEdit).toEqual(result.cold);
    expect(result.coldMs).toBeGreaterThan(0);
    expect(result.warmMs).toBeGreaterThan(0);
    expect(result.afterEditMs).toBeGreaterThan(0);
    expect(result.work.cold.records.hits).toBe(0);
    expect(result.work.cold.records.writes).toBeGreaterThan(0);
    expect(result.work.warm.records.hits).toBe(result.work.cold.records.writes);
    expect(result.work.warm.records.writes).toBe(0);
    expect(result.work.warm.parsed.lookups).toBe(0);
    expect(result.work.afterEdit.records.hits).toBeGreaterThan(0);
    expect(result.cacheAfterCold).toBe(true);
    expect(result.cacheMagic).toBe('VAIDXLSM');
    expect(result.cacheSegments).toBeGreaterThan(0);
  }, 120_000);
});

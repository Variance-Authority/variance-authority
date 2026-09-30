import { describe, expect, it } from 'vitest';
import { parseTiers, tierLabel, tierOf, TiersError } from './tiers.js';

const tiers = parseTiers([200000, 50000, 20000, 5000, 2000, 1000], 'variance.config.json');

describe('parseTiers', () => {
  it('refuses budgets that do not decrease, naming the tier that breaks the order', () => {
    expect(() => parseTiers([1000, 1000], 'v.json')).toThrow(/tier 1 \(1000\) is not below tier 0 \(1000\)/u);
    expect(() => parseTiers([1000, 2000], 'v.json')).toThrow(TiersError);
  });

  it('refuses an empty list and anything but positive whole lines', () => {
    expect(() => parseTiers([], 'v.json')).toThrow(/non-empty array/u);
    expect(() => parseTiers({ 0: 10 }, 'v.json')).toThrow(/non-empty array/u);
    expect(() => parseTiers([100, 0], 'v.json')).toThrow(/tier 1 is 0/u);
    expect(() => parseTiers([100, 2.5], 'v.json')).toThrow(/tier 1 is 2.5/u);
  });
});

describe('tierOf', () => {
  it('places a closure in the highest-numbered tier whose budget holds it, a budget holding its own size', () => {
    expect(tierOf(tiers, { lines: 1000, unsizedFiles: 0 })).toEqual({ tier: 5, atMost: false });
    expect(tierOf(tiers, { lines: 1001, unsizedFiles: 0 })).toEqual({ tier: 4, atMost: false });
    expect(tierOf(tiers, { lines: 0, unsizedFiles: 0 }).tier).toBe(5);
  });

  it('holds everything past the first budget in tier 0, which is unbounded', () => {
    expect(tierOf(tiers, { lines: 50001, unsizedFiles: 0 }).tier).toBe(0);
    expect(tierOf(tiers, { lines: 9_000_000, unsizedFiles: 0 }).tier).toBe(0);
  });

  it('reads a closure that reached unsized code as that tier or a lower-numbered one', () => {
    const place = tierOf(tiers, { lines: 900, unsizedFiles: 2 });
    expect(place).toEqual({ tier: 5, atMost: true });
    expect(tierLabel(place)).toBe('tier ≤ 5');
    expect(tierLabel(tierOf(tiers, { lines: 3000, unsizedFiles: 0 }))).toBe('tier 3');
  });
});

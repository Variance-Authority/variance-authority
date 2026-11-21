import { describe, expect, it } from 'vitest';
import { rarityNative, saturationNative } from './rarity.js';

/** The ranking weights the addon defines, as integers a sort key can hold exactly. */
describe('the ranking weights', () => {
  it('scores a word one row of ten holds nearly 1000, and one every row holds 1000 / (population + 1)', () => {
    expect(rarityNative(9, 1)).toBe(900);
    expect(rarityNative(9, 9)).toBe(100);
  });

  it('saturates a held term against the row length, and without a length when nothing was counted', () => {
    expect(saturationNative(1, 10, 0, 0)).toBe(1000);
    expect(saturationNative(2, 20, 100, 10)).toBe(1073);
  });
});

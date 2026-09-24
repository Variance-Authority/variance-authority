import { afterEach, expect, it, vi } from 'vitest';
import { locale } from '../src/locale.js';
import { formatPrice } from '../src/price.js';

afterEach(() => {
  vi.restoreAllMocks();
});

it('prices in euros', () => {
  vi.spyOn(locale, 'symbol').mockReturnValue('€');
  expect(formatPrice(500)).toBe('€5.00');
});

it('prices in dollars', () => {
  expect(formatPrice(500)).toBe('$5.00');
});

import { expect, it } from 'vitest';
import { formatPrice } from '../src/price.js';

it('computes the price', () => {
  expect(formatPrice(1234)).toBe('$12.34');
});

it('reads the price again', () => {
  expect(formatPrice(1234)).toBe('$12.34');
});

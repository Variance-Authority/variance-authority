import { expect, it } from 'vitest';
import { formatPrice } from '../src/price.js';

it('prints the price', () => {
  expect(formatPrice(1234)).toBe('$12.34');
});

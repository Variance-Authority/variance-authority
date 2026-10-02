import { expect, it } from 'vitest';
import { total } from '../src/cart.ts';

it('totals an empty cart', () => {
  expect(total([])).toBe(0);
});

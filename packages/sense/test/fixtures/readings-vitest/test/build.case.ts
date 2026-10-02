import { expect, it } from 'vitest';
import { total } from '../build/cart.js';

it('totals a full cart', () => {
  expect(total([1, 2])).toBe(3);
});

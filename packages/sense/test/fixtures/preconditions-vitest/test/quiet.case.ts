import { expect, it } from 'vitest';
import { total } from '../src/cart.js';

it('says nothing', () => {
  expect(total([9])).toBe(9);
});

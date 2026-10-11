import { expect, it } from 'vitest';
import { cap } from '../src/cap';

it('caps at the limit', () => {
  expect(cap(50)).toBe(10);
});

import { expect, it } from 'vitest';
import { add, twice } from '../src/index.cjs';

it('adds', () => {
  expect(add(1, 2)).toBe(3);
});

it('doubles', () => {
  expect(twice(2)).toBe(4);
});

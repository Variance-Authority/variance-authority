import { expect, it } from 'vitest';
import { add, half, twice } from '../src/index.cjs';

it('adds', () => {
  expect(add(1, 2)).toBe(3);
});

it('doubles', () => {
  expect(twice(2)).toBe(4);
});

it('halves', () => {
  expect(half(4)).toBe(2);
});

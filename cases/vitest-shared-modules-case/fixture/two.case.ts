import { expect, it } from 'vitest';
import { next, size } from './counter.js';
import { add } from './tally.js';

// The other case file is the same file. Whichever runs second in the worker
// meets the modules the first one loaded, with the values it left in them.
it('counts from one', () => {
  expect([next(), next(), size()]).toEqual([1, 2, 2]);
});

it('counts from one again, whatever the test before it left', () => {
  expect([next(), size()]).toEqual([1, 1]);
});

it('tallies from zero', () => {
  expect(add(5)).toBe(5);
});

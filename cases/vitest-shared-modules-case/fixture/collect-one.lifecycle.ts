import { expect, it } from 'vitest';
import { next, size } from './counter.js';

// The other collect file is the same file. A fresh file collects against the
// modules as they were loaded, so whichever runs second must not read what the
// first one's tests counted.
const initial = size();

it('collected the module as it was loaded', () => {
  expect(initial).toBe(0);
});

it('counts from one', () => {
  expect([next(), next()]).toEqual([1, 2]);
});

it('counts from one again, whatever the test before it left', () => {
  expect(next()).toBe(1);
});

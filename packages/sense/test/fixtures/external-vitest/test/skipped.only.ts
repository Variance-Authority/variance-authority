import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// Every test in the file skipped, which is the shape a platform check produces:
// `it.skipIf(isJsdom())` on each case, nothing left to run. The import above
// still runs — collection evaluates the file — so `decide` is loaded and a
// change to it breaks this file. Its own name stays out of `test/*.case.ts` so
// the runs the other configurations here make are unchanged.
it.skip('never runs, and neither does the hook that would record this file', () => {
  expect(decide('alpha')).toBe('A');
});

it.skip('is the second of two, so the file has no runnable test at all', () => {
  expect(decide('gamma')).toBe('G');
});

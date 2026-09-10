import { expect, it } from 'vitest';

// Never touches `src/decide.ts`: without isolation the module evaluates once
// for the worker, and what it did while evaluating is not this file's.
it('decides nothing', () => {
  expect(1 + 1).toBe(2);
});

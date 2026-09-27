import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// Two tests, and nothing in this file skips either of them. A name filter —
// `-t`, watch mode's `t`, an editor running one test from the gutter — leaves
// one of them out, and the runner writes that choice into the test's mode.
it('takes the alpha path', () => {
  expect(decide('alpha')).toBe('A');
});

it('takes the gamma path', () => {
  expect(decide('gamma')).toBe('G');
});

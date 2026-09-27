import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// One test that runs and one that is not written yet, which is the shape of
// every file that marks its gaps with a todo. The todo is declared through the
// options rather than as `it.todo`: the runner gives both spellings the same
// mode, and `it.todo` is how this repository writes down a gap of its own, so
// `tools/unrun.mjs` would count this input as one.
it('takes the alpha path', () => {
  expect(decide('alpha')).toBe('A');
});

it('takes the gamma path', { todo: true });

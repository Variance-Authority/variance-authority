// @vitest-environment jsdom

import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// A file the runner transforms in web mode, which is a different pipeline from
// the one every other case here goes through: the seam's setup module is
// rewritten by Vite's import analysis rather than externalized wholesale, so a
// specifier it names that only Node can resolve fails here and nowhere else.
it('decides in a document', () => {
  expect(typeof document).toBe('object');
  expect(decide('beta')).toBe('B');
});

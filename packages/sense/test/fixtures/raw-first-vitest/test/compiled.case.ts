import { expect, it } from 'vitest';
import { shout } from '../src/compiled.ts';

it('runs the module a compiler declared `enforce: pre` rewrote', () => {
  expect(shout('you')).toBe('HELLO YOU');
  // Set by the line the compiler wrote above the author's first, so the case
  // fails if the compiler never ran.
  expect((globalThis as { compiledAhead?: boolean }).compiledAhead).toBe(true);
});

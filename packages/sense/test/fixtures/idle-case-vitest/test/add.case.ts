import { expect, it } from 'vitest';
import { add } from '../src/add.js';

// Whether the case calls `add` is the run's to say, so one file can be recorded
// crossing it and then, finished again, recorded crossing nothing.
it('adds when asked', () => {
  if (process.env['VARIANCE_AUTHORITY_CALL'] === '1') expect(add(1, 2)).toBe(3);
  else expect(add).toBeTypeOf('function');
});

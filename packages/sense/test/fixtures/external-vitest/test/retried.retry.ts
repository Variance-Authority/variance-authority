import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

// Fails its first attempt and passes its second: the case a retry hides.
let attempt = 0;

it('passes on its second attempt', () => {
  attempt += 1;
  expect(decide(attempt === 1 ? 'alpha' : 'beta')).toBe('B');
});

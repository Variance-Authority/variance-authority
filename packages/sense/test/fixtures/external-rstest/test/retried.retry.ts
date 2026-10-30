import { expect, it } from '@rstest/core';
import { decide } from '../src/decide';

// Fails its first attempt and passes its second: the case a retry hides.
let attempt = 0;

it('passes on its second attempt', () => {
  attempt += 1;
  expect(decide(attempt === 1 ? 'alpha' : 'beta')).toBe('B');
});

import { expect, it } from '@rstest/core';
import { decide } from '../src/decide';

it('takes the beta path', () => {
  expect(decide('beta')).toBe('B');
});

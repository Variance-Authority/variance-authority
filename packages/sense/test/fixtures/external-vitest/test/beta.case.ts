import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

it('takes the beta path', () => {
  expect(decide('beta')).toBe('B');
});

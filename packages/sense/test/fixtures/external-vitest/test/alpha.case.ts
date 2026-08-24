import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

it('takes the alpha path', () => {
  expect(decide('alpha')).toBe('A');
});

it.skip('makes the file observation visibly partial', () => {
  expect(decide('beta')).toBe('B');
});

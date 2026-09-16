import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

it('takes the alpha path', () => {
  expect(decide('alpha')).toBe('A');
});

it.skip('is skipped, and so never reaches the B branch this file is not selected for', () => {
  expect(decide('beta')).toBe('B');
});

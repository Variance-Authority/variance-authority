import { expect, it } from 'vitest';
import { decide } from '../src/decide.js';

it('takes the alpha path', () => {
  expect(decide('alpha')).toBe('A');
});

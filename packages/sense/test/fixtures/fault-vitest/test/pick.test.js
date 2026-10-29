import { expect, it } from 'vitest';
import { checked, unchecked } from '../src/pick.js';

it('checks what checked returns', () => {
  expect(checked(1)).toBe('positive');
});

it('runs unchecked and checks nothing', () => {
  unchecked([], 1);
});

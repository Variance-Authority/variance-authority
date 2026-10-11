import { expect, it } from 'vitest';
import { floor } from '../src/cap';

it('floors at zero', () => {
  expect(floor(-5)).toBe(0);
});

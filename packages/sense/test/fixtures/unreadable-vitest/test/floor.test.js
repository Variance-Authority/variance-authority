import { expect, it } from 'vitest';
import { floor } from '../src/bounds';

it('floors at zero', () => {
  expect(floor(-5)).toBe(0);
});

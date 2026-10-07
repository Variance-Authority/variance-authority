import { expect, it } from 'vitest';
import { scale } from '../src/scale.ts';

it('scales a value', () => {
  expect(scale(2, 3)).toBe(6);
});

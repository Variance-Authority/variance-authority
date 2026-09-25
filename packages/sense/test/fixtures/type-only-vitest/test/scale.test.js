import { expect, it } from 'vitest';
import { scale } from '../src/scale.ts';

it('multiplies', () => {
  expect(scale(2, 4)).toBe(8);
});

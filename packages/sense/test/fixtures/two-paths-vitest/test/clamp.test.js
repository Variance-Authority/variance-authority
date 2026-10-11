import { expect, it } from 'vitest';
import { clamp } from '../src/clamp';

it('clamps at the most', () => {
  expect(clamp(50)).toBe(10);
});

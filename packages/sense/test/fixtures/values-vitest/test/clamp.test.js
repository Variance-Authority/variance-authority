import { expect, it } from 'vitest';
import { clamp } from '../src/limits';

it('clamps', () => {
  expect(clamp(99)).toBeLessThan(99);
});

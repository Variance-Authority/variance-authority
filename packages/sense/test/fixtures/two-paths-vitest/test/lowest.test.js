import { expect, it } from 'vitest';
import { lowest } from '../src/clamp';

it('clamps at zero', () => {
  expect(lowest(-5)).toBe(0);
});

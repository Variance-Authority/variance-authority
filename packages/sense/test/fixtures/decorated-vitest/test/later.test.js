import { expect, it } from 'vitest';
import { later } from '../src/decorated.ts';

it('adds', () => {
  expect(later(0)).toBe(55);
});

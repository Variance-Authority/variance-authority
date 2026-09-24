import { expect, it } from 'vitest';
import { slide } from '../src/slider';

it('stops at the limit', () => {
  expect(slide(99)).toBeLessThan(99);
});

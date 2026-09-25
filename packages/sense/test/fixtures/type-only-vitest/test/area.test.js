import { expect, it } from 'vitest';
import { area } from '../src/area.ts';

it('squares the side', () => {
  expect(area({ side: 3 })).toBe(9);
});

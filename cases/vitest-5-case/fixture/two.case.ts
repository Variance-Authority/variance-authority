import { expect, it } from 'vitest';
import { twice } from './node_modules/inlined/index.js';
import { add } from './add.js';

it('adds two', async () => {
  expect(await add(2, 2)).toBe(4);
});

it('doubles through a dependency', () => {
  expect(twice(2)).toBe(4);
});

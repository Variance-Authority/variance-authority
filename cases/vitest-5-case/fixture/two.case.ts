import { expect, it } from 'vitest';
import { add } from './add.js';

it('adds two', async () => {
  expect(await add(2, 2)).toBe(4);
});

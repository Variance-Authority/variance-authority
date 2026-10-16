import { expect, it } from 'vitest';
import { add } from './add.js';

it('adds one', () => {
  expect(add(1, 1)).toBe(2);
});

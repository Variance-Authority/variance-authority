import { expect, it } from 'vitest';
import { add } from './add.js';

it('adds two', () => {
  expect(add(1, 2)).toBe(3);
});

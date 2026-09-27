import { expect, it } from 'vitest';
import { add } from '../src/add.js';

it('adds under a project nobody wrapped', () => {
  expect(add(1, 2)).toBe(3);
});

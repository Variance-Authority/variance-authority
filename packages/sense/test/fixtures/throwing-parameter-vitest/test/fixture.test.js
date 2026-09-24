import { expect } from 'vitest';
import { test } from '../src/fixtures.js';

test('greets', ({ greeting }) => {
  expect(greeting).toBe('hello greets');
});

import { expect, it } from 'vitest';
import { add } from '../src/add.js';

it('adds under the dom project', () => {
  expect((globalThis as { project?: string }).project).toBe('dom');
  expect(add(1, 2)).toBe(3);
});

import { expect, it } from 'vitest';
import { add } from '../src/add.js';

it('adds under the unit project', () => {
  expect((globalThis as { project?: string }).project).toBe('unit');
  expect(add(1, 2)).toBe(3);
});

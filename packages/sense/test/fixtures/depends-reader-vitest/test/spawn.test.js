/// <depends path="../src/entry.ts" />
import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';

it('runs the entry in a process the record cannot see', () => {
  expect(existsSync(new URL('../src/entry.ts', import.meta.url))).toBe(true);
});

/// <depends path="../src/table.json" />
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps two rows', () => {
  expect(JSON.parse(readFileSync(new URL('../src/table.json', import.meta.url), 'utf8')).rows).toBe(2);
});

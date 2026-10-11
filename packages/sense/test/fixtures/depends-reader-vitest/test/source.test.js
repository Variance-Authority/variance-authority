/// <depends path="../src/rate.ts" />
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('keeps the rate a literal', () => {
  const text = readFileSync(new URL('../src/rate.ts', import.meta.url), 'utf8');
  expect(text).toMatch(/RATE = \d+;/);
});

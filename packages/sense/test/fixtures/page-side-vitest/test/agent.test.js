import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

it('runs the agent in the page', () => {
  const bundle = readFileSync(new URL('../src/agent.js', import.meta.url), 'utf8');
  expect(runInNewContext(`${bundle};agent.tag()`)).toBe('#text');
});

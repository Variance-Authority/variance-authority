import { readFileSync } from 'node:fs';
import { test as base, expect } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { moduleId } from '@variance-authority/sense/journal';

const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page hands over one crossing of `src/greet.ts`, the way an instrumented
// build's collector would, naming the text on disk.
const GREET = moduleId(
  'packages/playwright-test/test/fixtures/twin-projects/src/greet.ts',
  readFileSync(new URL('../src/greet.ts', import.meta.url), 'utf8'),
);
const COLLECTOR = `globalThis.__variance_authority_execution__ = {
  drain: () => ({ instrumentation: 'sense:instrument/presence-v5', modules: [{ id: '${GREET}', hits: [0], shared: [] }] }),
};`;

test('greets by name', async ({ page }) => {
  await page.setContent(`<script>${COLLECTOR}</script>`);
  expect(1).toBe(1);
});

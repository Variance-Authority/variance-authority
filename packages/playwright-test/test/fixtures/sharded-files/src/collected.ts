import { readFileSync } from 'node:fs';
import { test as base } from '@playwright/test';
import { varianceFixtures, type VarianceFixtures, type VarianceWorkerFixtures } from '@variance-authority/playwright-test';
import { moduleId } from '@variance-authority/sense/journal';

export const test = base.extend<VarianceFixtures, VarianceWorkerFixtures>(varianceFixtures);

// The page hands over one crossing of this module, the way an instrumented
// build's collector would, naming the text on disk.
const SELF = moduleId(
  'packages/playwright-test/test/fixtures/sharded-files/src/collected.ts',
  readFileSync(new URL('./collected.ts', import.meta.url), 'utf8'),
);

/** A page whose collector reports one crossing, so every test is recorded. */
export const COLLECTOR = `<script>globalThis.__variance_authority_execution__ = {
  drain: () => ({ instrumentation: 'sense:instrument/presence-v6', modules: [{ id: '${SELF}', hits: [0], shared: [] }] }),
};</script>`;

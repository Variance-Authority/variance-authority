import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

// Three spec files of three tests each, every test its own group: Playwright's
// own `--shard` would cut a file between shards.
const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}

export default defineConfig(
  withTestSelection(
    {
      testDir: 'tests',
      fullyParallel: true,
      workers: 2,
      reporter: [['line']],
    },
    { root, cacheRoot, coverageFile },
  ),
);

import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}

// Its cases fail on purpose, so it is a fixture of its own: the run in
// `../preconditions` passes whole. A failed case restarts the worker, so the
// reporter folds what each worker recorded of the one spec.
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: [['line'], ['@variance-authority/playwright-test/reporter', { root, cacheRoot, coverageFile }]],
  use: { varianceExecution: { root, cacheRoot, coverageFile } },
});

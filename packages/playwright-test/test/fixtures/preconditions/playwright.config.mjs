import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}

export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: 'line',
  use: { varianceExecution: { root, cacheRoot, coverageFile } },
});

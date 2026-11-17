import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}

// `clicks` and `ticks` run side by side: each is judged against its own runs,
// and a throw restarts only its own worker.
export default defineConfig(withTestSelection({ testDir: 'tests', fullyParallel: true, workers: 2, reporter: [['line']] }, { root, cacheRoot, coverageFile }));

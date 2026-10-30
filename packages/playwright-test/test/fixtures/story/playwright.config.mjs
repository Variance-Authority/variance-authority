import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}

// The spec that fails its first attempt runs only when the test that runs this fixture asks for it.
const retried =
  process.env['FIXTURE_RETRIED'] === undefined
    ? { testIgnore: ['**/retried.spec.ts'] }
    : { testMatch: ['**/retried.spec.ts'], retries: 1 };

export default defineConfig(
  withTestSelection({ testDir: 'tests', workers: 1, reporter: [['line']], ...retried }, { root, cacheRoot, coverageFile }),
);

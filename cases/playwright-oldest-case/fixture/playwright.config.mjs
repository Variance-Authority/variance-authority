import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

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
      workers: 1,
      reporter: [['line']],
      // The browser the repository installs: this Playwright's own build is not on a machine that runs the suite.
      use: { launchOptions: { executablePath: process.env['FIXTURE_CHROMIUM'] } },
    },
    { root, cacheRoot, coverageFile },
  ),
);

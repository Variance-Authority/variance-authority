import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

// Two projects over the one spec, as a suite runs it once at each viewport.
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
      projects: [
        { name: 'desktop', use: { viewport: { width: 1280, height: 720 } } },
        { name: 'narrow', use: { viewport: { width: 390, height: 844 } } },
      ],
    },
    { root, cacheRoot, coverageFile },
  ),
);

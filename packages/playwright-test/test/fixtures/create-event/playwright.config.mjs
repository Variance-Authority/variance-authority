import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
if (coverageFile === undefined || cacheRoot === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE and VARIANCE_AUTHORITY_CACHE are required');
}

// A comma-separated list runs the suite once per named project, so a run can narrow to one.
const projects = process.env['PROJECTS']?.split(',').map((name) => ({ name }));

export default defineConfig(withTestSelection(
  { testDir: 'tests', workers: 1, reporter: [['line']], ...(projects === undefined ? {} : { projects }) },
  { root, cacheRoot, coverageFile },
));

import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const root = fileURLToPath(new URL('.', import.meta.url));
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
const cacheRoot = process.env['VARIANCE_AUTHORITY_CACHE'];
const baselines = process.env['VARIANCE_AUTHORITY_BASELINES'];
const report = process.env['VARIANCE_AUTHORITY_REPORT'];
if (coverageFile === undefined || cacheRoot === undefined || baselines === undefined || report === undefined) {
  throw new Error('VARIANCE_AUTHORITY_COVERAGE, VARIANCE_AUTHORITY_CACHE, VARIANCE_AUTHORITY_BASELINES and VARIANCE_AUTHORITY_REPORT are required');
}

export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: [['line'], ['json', { outputFile: report }]],
  use: { varianceBaselines: baselines },
  projects: [
    { name: 'listening', use: { varianceExecution: { root, cacheRoot, coverageFile } } },
    // The same snapshot from a run that records nothing, so nothing listens.
    { name: 'deaf', grep: /photographs the receipt/, use: { varianceExecution: false } },
  ],
});

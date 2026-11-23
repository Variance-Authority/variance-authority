import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

// The case root: the page is instrumented from here, and the record is kept
// for it, where a question asked of this root finds it.
const root = dirname(dirname(fileURLToPath(import.meta.url)));

export default defineConfig(withTestSelection({
  testDir: './spec',
  outputDir: process.env.VA_RESULTS,
  workers: 1,
  reporter: [['line']],
  use: { browserName: 'chromium' },
}, { root }));

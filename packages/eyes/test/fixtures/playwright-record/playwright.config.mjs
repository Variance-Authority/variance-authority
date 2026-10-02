import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

// The specs and the page script the run instruments are both in this directory.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig(withTestSelection({
  testDir: './spec',
  outputDir: process.env.EYES_RESULTS,
  workers: 2,
  retries: 1,
  reporter: [['line']],
  use: { browserName: 'chromium' },
}, {
  root,
  cacheRoot: process.env.EYES_CACHE,
  coverageFile: process.env.EYES_RECORD,
}));

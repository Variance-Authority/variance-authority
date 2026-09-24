import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './spec',
  outputDir: process.env.EYES_RESULTS,
  workers: 2,
  retries: 1,
  reporter: [['line'], ['@variance-authority/eyes/reporter', { archive: process.env.EYES_ARCHIVE }]],
  use: { browserName: 'chromium' },
});

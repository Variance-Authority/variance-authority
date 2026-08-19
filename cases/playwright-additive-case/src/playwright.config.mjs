import { defineConfig } from '@playwright/test';
import { CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright-test';

export default defineConfig({
  testDir: './spec',
  outputDir: process.env.VA_RESULTS,
  workers: 1,
  reporter: 'line',
  use: {
    browserName: 'chromium',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    launchOptions: { args: [...CHROMIUM_RASTER_ARGS] },
    viewport: { width: 800, height: 600 },
  },
});

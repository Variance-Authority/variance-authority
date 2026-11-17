import { defineConfig } from '@playwright/test';

const port = process.env.VA_PORT ?? '4391';

export default defineConfig({
  testDir: './spec',
  outputDir: process.env.VA_RESULTS,
  workers: 4,
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: `http://localhost:${port}`, browserName: 'chromium' },
  webServer: {
    command: 'node server.mjs',
    url: `http://localhost:${port}/checkout`,
    reuseExistingServer: false,
    env: { VA_PORT: port, VARIANCE_AUTHORITY_EVENTS: '1' },
  },
});

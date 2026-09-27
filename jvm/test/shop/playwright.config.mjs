import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  reporter: [['json', { outputFile: process.env.VA_RESULTS ?? 'results.json' }]],
  use: { baseURL: `http://localhost:${process.env.PORT ?? 8123}` },
});

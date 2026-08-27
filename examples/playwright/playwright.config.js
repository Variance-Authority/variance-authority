import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  use: { baseURL: 'http://localhost:5174', viewport: { width: 800, height: 600 } },

  // Playwright starts and stops the app. Nothing about this example is special:
  // it is the `webServer` block a suite this size already has.
  webServer: { command: 'node server.mjs', url: 'http://localhost:5174', reuseExistingServer: true },
});

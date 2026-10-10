import { defineConfig } from '@playwright/test';

// The project names no timezone or locale; the spec sets its own, as a describe
// block in a real suite does for the one page that formats dates.
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: [['line']],
  use: { varianceBaselines: process.env['VARIANCE_AUTHORITY_BASELINES'] },
});

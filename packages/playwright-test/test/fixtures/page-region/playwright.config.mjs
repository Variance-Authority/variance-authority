import { defineConfig } from '@playwright/test';

// One project declares no timezone or locale, as most suites do; there a spec
// either sets its own with `test.use`, as a describe block in a real suite does
// for the one page that formats dates, or takes the fixtures' pin. The other
// project declares both, as a suite that runs in one region does.
export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: [['line']],
  use: { varianceBaselines: process.env['VARIANCE_AUTHORITY_BASELINES'] },
  projects: [
    { name: 'undeclared', testIgnore: 'declared.spec.ts' },
    { name: 'declared', testMatch: 'declared.spec.ts', use: { timezoneId: 'Asia/Tokyo', locale: 'de-DE' } },
  ],
});

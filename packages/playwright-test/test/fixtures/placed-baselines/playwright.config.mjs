import { defineConfig } from '@playwright/test';

// Two projects that differ only in the colour scheme, which the render identity
// does not hold: one path each, because the template places by `{project}`.
const baselines = process.env['VARIANCE_AUTHORITY_BASELINES'];
if (baselines === undefined) throw new Error('VARIANCE_AUTHORITY_BASELINES is required');

export default defineConfig({
  testDir: 'tests',
  workers: 1,
  reporter: [['line']],
  use: { varianceBaselines: baselines, varianceBaselinePath: '{project}/{title}/{name}-{engine}' },
  projects: [
    { name: 'light', use: { colorScheme: 'light' } },
    { name: 'dark', use: { colorScheme: 'dark' } },
  ],
});

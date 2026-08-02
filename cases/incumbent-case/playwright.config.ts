import { defineConfig } from '@playwright/test';
import { CONFIGURATIONS } from './src/scenarios.js';

/**
 * The incumbent's own runner, configured the way a team would configure it.
 *
 * Two projects, because running one would be a straw man whichever one it was.
 * `strict` is what `@playwright/test` ships: no tolerance at all, so a single
 * differing pixel fails. No real suite survives that for long, and a comparison
 * that only ran it would be measuring a configuration nobody uses. `tolerant`
 * sets `maxDiffPixelRatio` to 0.01, which is the number teams reach for when
 * antialiasing starts costing them mornings.
 *
 * Everything else is left alone. `threshold`, `animations`, `caret`, `scale` and
 * the comparator are Playwright's, at Playwright's values — the point of running
 * their runner rather than reimplementing it is that the defaults are theirs and
 * not our reading of their documentation.
 */
export default defineConfig({
  testDir: './src',
  testMatch: '**/*.spec.ts',

  // Artifacts live under `incumbent/`, which is gitignored: the baselines are
  // this machine's Chromium and belong to a run rather than to the repository.
  outputDir: './incumbent/output',
  snapshotPathTemplate: './incumbent/baselines/{projectName}/{arg}{ext}',

  reporter: [['json', { outputFile: './incumbent/results.json' }], ['line']],

  // Retries are the first thing a flaky suite reaches for, and this repository's
  // position is that re-observing until two observations agree hides the finding
  // (architecture contract 4). Zero here so a result is a result.
  retries: 0,
  forbidOnly: true,

  projects: CONFIGURATIONS.map((configuration) => ({
    name: configuration.id,
    use: {
      viewport: { width: 800, height: 600 },
      deviceScaleFactor: 1,
      colorScheme: 'light' as const,
    },
    expect:
      configuration.maxDiffPixelRatio === undefined
        ? {}
        : { toHaveScreenshot: { maxDiffPixelRatio: configuration.maxDiffPixelRatio } },
  })),
});

// An ordinary Playwright project over a built Storybook, with recording on.
//
// `withTestSelection` is the whole adoption: the specs import `test` from a
// fixture module that extends `@playwright/test` with `varianceFixtures`, and
// nothing else in them knows a recording is being made.
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

const port = process.env.VA_PORT ?? '6311';

export default defineConfig(
  withTestSelection(
    {
      testDir: './spec',
      outputDir: process.env.VA_RESULTS,
      // Two workers, so the run is folded by the reporter rather than written
      // by whichever worker closed last.
      workers: 2,
      fullyParallel: true,
      reporter: [['list']],
      use: { baseURL: `http://localhost:${port}`, browserName: 'chromium' },
      webServer: {
        command: 'node server.mjs',
        url: `http://localhost:${port}/iframe.html`,
        env: { VA_PORT: port },
      },
    },
    {
      root: dirname(dirname(fileURLToPath(import.meta.url))),
      // The label the Storybook build gave `testSelectionProbes()`.
      label: 'storybook',
      ...(process.env.VA_COVERAGE === undefined ? {} : { coverageFile: process.env.VA_COVERAGE }),
    },
  ),
);

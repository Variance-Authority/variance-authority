import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { withTestSelection } from '@variance-authority/playwright-test';

const port = process.env.VA_PORT;
// The case root, not the config's directory: the driver and the service must
// agree on what a recorded path is relative to, and a service started by
// `webServer` runs beside this file rather than beside the specs it serves.
const root = dirname(dirname(fileURLToPath(import.meta.url)));

export default defineConfig(withTestSelection({
  testDir: './spec',
  outputDir: process.env.VA_RESULTS,
  workers: 2,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    browserName: 'chromium',
  },
  webServer: {
    command: 'node server.mjs',
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    env: {
      VA_PORT: port,
      VA_ROOT: root,
      // One block, both instruments. Neither value is a path.
      VARIANCE_AUTHORITY_EVENTS: '1',
      VARIANCE_AUTHORITY_JOURNEYS: '1',
      VARIANCE_AUTHORITY_HEAD: 'pricing',
    },
  },
}, {
  // The page is not instrumented, and nothing here pretends it is. Everything
  // this run records was executed in another process — one place to say it,
  // read by the fixtures in every worker and by the fold at the end.
  root,
  heads: ['pricing'],
  coverageFile: process.env.VA_COVERAGE,
}));

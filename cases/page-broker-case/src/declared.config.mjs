// A shop that says nothing, and Storybook's own manager, driven through
// `@variance-authority/page-broker`: two apps that announce nothing.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const shop = process.env.VA_PORT ?? '4392';
const storybook = process.env.VA_STORYBOOK_PORT ?? '4393';
// The build `cases/storybook-case` makes; nothing in it is changed for this case.
const built = fileURLToPath(new URL('../../storybook-case/storybook-static/', import.meta.url));

export default defineConfig({
  testDir: './declared',
  outputDir: process.env.VA_RESULTS,
  workers: 4,
  fullyParallel: true,
  reporter: [['list']],
  use: { browserName: 'chromium' },
  projects: [
    { name: 'shop', testMatch: 'shop.spec.ts', use: { baseURL: `http://localhost:${shop}` } },
    { name: 'storybook', testMatch: 'storybook.spec.ts', use: { baseURL: `http://localhost:${storybook}` } },
  ],
  webServer: [
    {
      command: 'node server.mjs',
      url: `http://localhost:${shop}/checkout`,
      reuseExistingServer: false,
      env: { VA_PORT: shop },
    },
    ...(existsSync(`${built}index.json`)
      ? [
          {
            command: 'node ../../playwright-storybook-case/src/server.mjs',
            url: `http://localhost:${storybook}/index.json`,
            reuseExistingServer: false,
            env: { VA_PORT: storybook, VA_STATIC: built },
          },
        ]
      : []),
  ],
});

import { defineConfig } from '@rstest/core';
import { definePlaywrightConfig } from '@rstest/playwright/config';
import { CHROMIUM_RASTER_ARGS } from '@variance-authority/playwright-test';

export default defineConfig({
  extends: definePlaywrightConfig({
    // What the fixture launches. The same list is declared to the observation
    // as the browser it was photographed in, and renderer identity is what
    // makes the two runs comparable at all.
    launchOptions: { args: [...CHROMIUM_RASTER_ARGS] },
    contextOptions: {
      colorScheme: 'light',
      deviceScaleFactor: 1,
      viewport: { width: 800, height: 600 },
    },
  }),
  include: ['cart.e2e.test.mjs'],
  testEnvironment: 'node',
});

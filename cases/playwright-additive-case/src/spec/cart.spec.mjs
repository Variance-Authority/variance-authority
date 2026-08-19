import { test, expect } from '@playwright/test';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
} from '@variance-authority/playwright-test';

test('observes without replacing Playwright primitives', async ({ page }, testInfo) => {
  await page.setContent(
    '<main><section id="cart" style="width:240px;padding:16px"><h1>Cart</h1><p>Empty</p></section></main>',
  );
  const variance = await createVariance(page, testInfo, {
    baselines: process.env.VA_BASELINES,
    materialization: {
      kind: 'in-place',
      browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
    },
  });

  try {
    const observation = await variance.observe(page.locator('#cart'), {
      subjectId: 'cart/empty',
    });
    expect(observation.subject).toBe('cart/empty');
    if (process.env.VA_ACCEPT !== '1') {
      assertUnchanged(observation);
      expect(observation.verdict).toBe('unchanged');
    } else {
      expect(observation.verdict).toBe('new');
    }
  } finally {
    await variance.close();
  }
});

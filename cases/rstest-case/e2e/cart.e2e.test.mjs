import { describe, test } from '@rstest/playwright';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
} from '@variance-authority/playwright-test';
import { runOf } from '@variance-authority/playwright-test/rstest';

describe('cart', () => {
  test('empty', async ({ page, task, expect, playwright }) => {
    await page.setContent(
      '<main><section id="cart" style="width:240px;padding:16px"><h1>Cart</h1><p>Empty</p></section></main>',
    );

    // Three of the values the body destructures, and no `TestInfo`: the title
    // path is on `expect`, the spec file on `task`, the raster partition on the
    // resolved `playwright` fixture.
    const variance = await createVariance(page, runOf({ task, expect, playwright }), {
      baselines: process.env.VA_BASELINES,
      materialization: {
        kind: 'in-place',
        browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
      },
    });

    try {
      const observation = await variance.observe(page.locator('#cart'));
      // Nothing named this subject: `cart > empty` is the run's own id, and the
      // separator Rstest joins a suite chain with is translated on the way in.
      expect(observation.subject).toBe('cart/empty');
      assertUnchanged(observation);
      expect(observation.verdict).toBe('unchanged');
    } finally {
      await variance.close();
    }
  });
});

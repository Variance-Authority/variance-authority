/**
 * The renderer a test's document is painted by, chosen by the page it came from,
 * and the timezone that page opens in when the suite declares none.
 *
 * A page's scripts format its dates and numbers in the timezone and locale the
 * page runs in, and the renderer runs those scripts again, so the two must
 * agree. Playwright sets them per test — `test.use({ timezoneId })` in one
 * describe block is how a suite pins the one page that formats dates — and a
 * worker fixture cannot read a test's options. So the page is asked, through
 * {@link regionOf}, the same question the acquisition asks for its environment
 * key: one owner for both answers.
 *
 * Renderers are still one per worker per region, never one per test: a launch
 * and first navigation cost two orders of magnitude more than a warm render
 * (journal 0007), and nearly every suite runs in one region.
 *
 * A suite that declares no `timezoneId` gets `UTC`, not the host's. Playwright
 * Test opens a context in the host's timezone when nothing sets one, so a page
 * read on a laptop in Sydney and one read on a CI runner in UTC would carry
 * different keys, and every change would name the timezone. Its `locale` needs no pin: Playwright
 * Test already defaults it to `en-US`, the default the collectors pin.
 */

import type {
  Fixtures,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
} from '@playwright/test';
import type { PageRegion } from '@variance-authority/core/format';
import { pinnedRegion } from '@variance-authority/playwright';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import type { Renderer } from '@variance-authority/raster';
import { regionOf } from './in-place.js';

/** Renderers a worker holds, one for each timezone and locale its pages ran in. */
export interface RendererPool {
  /** The renderer that paints in `region`, launched the first time it is asked for. */
  readonly for: (region: Required<PageRegion>) => Promise<Renderer>;
}

export interface VarianceRendererFixtures {
  /** The renderer this test's page is painted by: the one for the timezone and locale the page runs in. */
  readonly varianceRenderer: Renderer;
}

export interface VarianceRendererWorkerFixtures {
  /** The worker's renderers, closed when the worker is. */
  readonly varianceRenderers: RendererPool;
}

export const varianceRendererFixtures: Fixtures<
  VarianceRendererFixtures,
  VarianceRendererWorkerFixtures,
  PlaywrightTestArgs & PlaywrightTestOptions,
  PlaywrightWorkerArgs
> = {
  // Depends on its own name, so it receives the value Playwright resolved —
  // `use`, a project's `use`, or `contextOptions` — and pins only its absence.
  timezoneId: async ({ timezoneId }, use) => {
    await use(timezoneId ?? pinnedRegion({}).timezoneId);
  },

  varianceRenderers: [
    // Playwright reads this parameter's destructured names to discover a
    // fixture's dependencies, and rejects a parameter it cannot destructure. An
    // empty pattern is how "depends on nothing" is spelled.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const launched = new Map<string, Promise<Renderer>>();
      await use({
        for: (region) => {
          const key = `${region.timezoneId}\u0000${region.locale}`;
          let renderer = launched.get(key);
          if (renderer === undefined) {
            renderer = createPlaywrightRenderer(region);
            launched.set(key, renderer);
          }
          return renderer;
        },
      });
      await Promise.all([...launched.values()].map(async (renderer) => (await renderer).close()));
    },
    { scope: 'worker' },
  ],

  varianceRenderer: async ({ page, varianceRenderers }, use) => {
    await use(await varianceRenderers.for(await regionOf(page)));
  },
};

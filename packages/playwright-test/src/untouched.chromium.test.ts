import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { DEFAULT_NOW } from '@variance-authority/core/format';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import type { Renderer } from '@variance-authority/raster';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundlePageAgent } from './bundle.js';
import type { Observed } from './evidence.js';
import { driveBeforeTest } from './drive.js';
import { observeLocator } from './fixture.js';
import { CHROMIUM_RASTER_ARGS, runOf, varianceFixtures } from './index.js';
import type { VarianceOptions } from './options.js';
import { checkoutStore } from './render-cache.js';

/**
 * The clock and the motion preference a test's page loads under.
 *
 * Both are read by the page's first script, before the test reaches its first
 * observation, so only something that runs before the test body can set them:
 * the `variance` fixture does, on the page it hands the test.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test untouched: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const STYLE = `<style>
  p { margin: 0; font: 16px sans-serif; }
  #motion { color: rgb(200, 0, 0); }
  @media (prefers-reduced-motion: reduce) { #motion { color: rgb(0, 128, 0); } }
</style>`;

/** A page that prints the time and starts its animation only when motion is welcome. */
const LIVE = `${STYLE}<main id="subject"><p id="now"></p><p id="motion"></p></main><script>
  document.getElementById('now').textContent = new Date().toISOString();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById('motion').textContent = reduced ? 'still' : 'moving';
</script>`;

/** What that page reads at the fixed instant, with motion reduced. */
const HELD = `${STYLE}<main id="subject"><p id="now">${DEFAULT_NOW}</p><p id="motion">still</p></main>`;

const URL = 'http://subject.test/';

/** Photographed off the live page, whose reading carries the recipe it was held under. */
const IN_PLACE = {
  kind: 'in-place',
  browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
} as const;

type VarianceFixture = (
  fixtures: Record<string, unknown>,
  use: (variance: (locator: Locator, options?: VarianceOptions) => Promise<Observed>) => Promise<void>,
  testInfo: TestInfo,
) => Promise<void>;

const varianceFixture = varianceFixtures.variance as unknown as VarianceFixture;

/** The fixture `variance` depends on, which drives the page before the test body. */
const drivenFixture = varianceFixtures.varianceDriven as unknown as (
  fixtures: Record<string, unknown>,
  use: (driven: readonly string[]) => Promise<void>,
) => Promise<void>;

let browser: Browser | undefined;
let renderer: Renderer | undefined;
let bundle = '';
let directory = '';

function info(updateSnapshots: 'all' | 'none'): TestInfo {
  return {
    titlePath: ['untouched.spec.ts', 'clock and motion'],
    file: join(directory, 'untouched.spec.ts'),
    testId: 'untouched',
    config: { updateSnapshots },
    project: { name: 'chromium', use: { colorScheme: 'light', deviceScaleFactor: 1 } },
    annotations: [],
    outputPath: (...parts: string[]) => join(directory, 'output', ...parts),
    attach: async () => {},
  } as unknown as TestInfo;
}

async function serving(page: Page, html: string): Promise<void> {
  await page.route(URL, (route) => route.fulfill({ contentType: 'text/html', body: html }));
}

/** One test that takes `page` and `variance`, as a spec destructures them. */
async function throughFixture(
  html: string,
  updateSnapshots: 'all' | 'none',
  test: (page: Page, variance: (locator: Locator) => Promise<Observed>) => Promise<void>,
): Promise<void> {
  const context = await browser!.newContext({ viewport: { width: 400, height: 200 } });
  const page = await context.newPage();
  const { store } = checkoutStore(join(directory, 'baselines'));
  try {
    await drivenFixture({ page, varianceStabilize: undefined, varianceNow: undefined }, async (driven) => {
      await varianceFixture(
        {
          page,
          varianceBundle: bundle,
          varianceRecorder: undefined,
          varianceRenderer: renderer,
          varianceStore: store,
          varianceJourney: undefined,
          varianceVantage: undefined,
          varianceDriven: driven,
        },
        async (variance) => {
          await serving(page, html);
          await page.goto(URL);
          await test(page, (locator) => variance(locator, { subjectId: 'untouched/clock-and-motion' }));
        },
        info(updateSnapshots),
      );
    });
  } finally {
    await context.close();
  }
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  directory = await mkdtemp(join(tmpdir(), 'variance-untouched-'));
  browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
  renderer = await createPlaywrightRenderer();
  bundle = await bundlePageAgent();
}, 60_000);

afterAll(async () => {
  await renderer?.close();
  await browser?.close();
  if (directory !== '') await rm(directory, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('a page the variance fixture hands a test', () => {
  it('loads at the fixed instant with motion reduced', async () => {
    await throughFixture(HELD, 'all', async (page, variance) => {
      await variance(page.locator('#subject'));
    });

    await throughFixture(LIVE, 'none', async (page, variance) => {
      expect((await variance(page.locator('#subject'))).verdict).toBe('unchanged');
      expect(await page.locator('#motion').evaluate((element) => getComputedStyle(element).color)).toBe(
        'rgb(0, 128, 0)',
      );
    });

  }, 120_000);

  it('fixes Date alone, and frames, timers and performance keep running on the page time', async () => {
    // A frame's timestamp is `document.timeline`'s time, which drives every CSS
    // and Web Animations frame. A fake `requestAnimationFrame` hands callbacks a
    // time of its own, and an animation a script steps by it drifts from the one
    // the compositor steps.
    const context = await browser!.newContext({ viewport: { width: 400, height: 200 } });
    try {
      const page = await context.newPage();
      await driveBeforeTest(page, { stabilize: undefined, now: undefined });
      await serving(page, HELD);
      await page.goto(URL);

      const read = await page.evaluate(
        () =>
          new Promise((resolve) => {
            requestAnimationFrame((time) => {
              resolve({
                date: [new Date().toISOString(), new Date(Date.now()).toISOString()],
                frameOnTimeline: time === document.timeline.currentTime,
                native: [setTimeout, requestAnimationFrame, performance.now].map((fn) =>
                  fn.toString().includes('[native code]'),
                ),
              });
            });
          }),
      );

      expect(read).toEqual({ date: [DEFAULT_NOW, DEFAULT_NOW], frameOnTimeline: true, native: [true, true, true] });
    } finally {
      await context.close();
    }
  }, 60_000);

  it('leaves `page.clock` to the test, so a clock the test installs is the one its page reads', async () => {
    // The fixture drives the page before the test body, so a test's own
    // `install` comes after, and its fake `Date` replaces the frozen one.
    const context = await browser!.newContext({ viewport: { width: 400, height: 200 } });
    try {
      const page = await context.newPage();
      await driveBeforeTest(page, { stabilize: undefined, now: undefined });
      await page.clock.install({ time: new Date('2030-01-01T00:00:00Z') });
      await serving(page, HELD);
      await page.goto(URL);
      await page.evaluate(() => {
        Reflect.set(globalThis, 'fired', false);
        setTimeout(() => Reflect.set(globalThis, 'fired', true), 60_000);
      });
      await page.clock.runFor(60_000);

      expect(await page.evaluate(() => [new Date().getUTCFullYear(), Reflect.get(globalThis, 'fired')])).toEqual([
        2030,
        true,
      ]);
    } finally {
      await context.close();
    }
  }, 60_000);

  it('records the clock and the motion preference it set, so a reading without them names them as its cause', async () => {
    const context = await browser!.newContext({ viewport: { width: 400, height: 200 } });
    try {
      const page = await context.newPage();
      const driven = await driveBeforeTest(page, { stabilize: undefined, now: undefined });
      await page.addInitScript(bundle);
      await serving(page, HELD);
      await page.goto(URL);
      const { store } = checkoutStore(join(directory, 'baselines'));
      const runtime = (updateSnapshots: 'all' | 'none') => ({
        page,
        run: runOf(info(updateSnapshots)),
        store,
        materialization: IN_PLACE,
      });
      const subject = page.locator('#subject');
      const options = { subjectId: 'untouched/recorded' };

      await observeLocator({ ...runtime('all'), driven }, subject, options);
      expect((await observeLocator({ ...runtime('none'), driven }, subject, options)).verdict).toBe('unchanged');
      const undriven = await observeLocator(runtime('none'), subject, options);
      expect(undriven.signals?.moved?.some((field) => field.startsWith('stabilization'))).toBe(true);
    } finally {
      await context.close();
    }
  }, 120_000);
});

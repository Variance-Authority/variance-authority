import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHROMIUM_RASTER_ARGS, observe } from './index.js';

/**
 * A pointer and a focus the test left behind.
 *
 * A test hovers a menu to open it, or fills a field, and observes afterwards.
 * Where the pointer rests and which element holds focus are then whatever the
 * last step left, so one subject observed by two tests reads two ways — and a
 * test that moves its last click by a row moves the baseline. By default an
 * observation is taken with the pointer off the page and nothing focused.
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
    '\npackages/playwright-test interaction: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const PAGE = `<style>
  button { background: rgb(240, 240, 240); color: black; border: 0; padding: 8px; }
  button:hover { background: rgb(200, 0, 0); }
  input { outline: none; border: 1px solid gray; }
  input:focus, input:focus-visible { outline: 4px solid rgb(0, 0, 200); }
</style><main id="subject"><button>Pay</button><input value="card"></main>`;

/** Everything the default recipe holds, except the one trick a test leaves out. */
const WITHOUT_NO_HOVER = [
  'pin-animations',
  'hide-scrollbars',
  'hide-caret',
  'no-focus',
  'wait-for-fonts',
  'wait-for-images',
];

/**
 * Photographed off the live page, which is where a pointer and a focus are.
 *
 * A deferred render paints the captured document in a page of its own, where
 * nothing is hovered or focused, so this is the path the test's own state reaches.
 */
const IN_PLACE = {
  kind: 'in-place',
  browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
} as const;

let browser: Browser | undefined;
let page: Page | undefined;
let baselines = '';

function info(updateSnapshots: 'all' | 'none'): TestInfo {
  return {
    titlePath: ['interaction', 'checkout'],
    config: { updateSnapshots },
    project: { use: { colorScheme: 'light', deviceScaleFactor: 1 } },
  } as unknown as TestInfo;
}

beforeAll(async () => {
  if (BROWSER_AVAILABLE) {
    browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
  }
});

afterAll(async () => {
  await browser?.close();
});

beforeEach(async () => {
  if (!BROWSER_AVAILABLE) return;
  baselines = await mkdtemp(join(tmpdir(), 'variance-interaction-'));
  page = await browser!.newPage({ viewport: { width: 400, height: 200 } });
  await page.setContent(PAGE);
});

afterEach(async () => {
  await page?.close();
  if (baselines !== '') await rm(baselines, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('what a test leaves behind before it observes', () => {
  it('observes a hovered button as it looks with the pointer elsewhere', async () => {
    const subject = page!.locator('#subject');
    await observe(page!, subject, info('all'), { baselines, materialization: IN_PLACE, subjectId: 'checkout/hover' });

    await page!.locator('button').hover();
    const hovered = await observe(page!, subject, info('none'), {
      baselines,
      materialization: IN_PLACE,
      subjectId: 'checkout/hover',
    });

    expect(hovered.verdict).toBe('unchanged');
  }, 60_000);

  it('observes a focused field as it looks with nothing focused', async () => {
    const subject = page!.locator('#subject');
    await observe(page!, subject, info('all'), { baselines, materialization: IN_PLACE, subjectId: 'checkout/focus' });

    await page!.locator('input').focus();
    const focused = await observe(page!, subject, info('none'), {
      baselines,
      materialization: IN_PLACE,
      subjectId: 'checkout/focus',
    });

    expect(focused.verdict).toBe('unchanged');
  }, 60_000);

  it('hands focus back to the field once it has observed, so the test types where it left off', async () => {
    await page!.locator('input').focus();
    await observe(page!, page!.locator('#subject'), info('all'), {
      baselines,
      materialization: IN_PLACE,
      subjectId: 'checkout/refocus',
    });

    expect(await page!.evaluate(() => document.activeElement?.tagName)).toBe('INPUT');
  }, 60_000);

  it('keeps the hover a test asked for, when its recipe leaves the pointer alone', async () => {
    const subject = page!.locator('#subject');
    const options = {
      baselines,
      materialization: IN_PLACE,
      subjectId: 'checkout/kept-hover',
      stabilize: WITHOUT_NO_HOVER,
    };
    await observe(page!, subject, info('all'), { ...options, stabilize: undefined });
    await page!.locator('button').hover();

    // A baseline held with the pointer off the page is not compared against a
    // reading that kept it: the recipe is part of the key.
    expect((await observe(page!, subject, info('none'), options)).verdict).toBe('incomparable');

    await observe(page!, subject, info('all'), options);
    await page!.mouse.move(-1, -1);

    expect((await observe(page!, subject, info('none'), options)).verdict).toBe('changed');
  }, 60_000);
});

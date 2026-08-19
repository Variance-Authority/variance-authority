import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertUnchanged, observe } from './index.js';

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

let browser: Browser | undefined;
let page: Page | undefined;
let baselines = '';

function info(updateSnapshots: 'all' | 'none'): TestInfo {
  return {
    titlePath: ['direct integration', 'cart'],
    config: { updateSnapshots },
    project: { use: { colorScheme: 'light', deviceScaleFactor: 1 } },
  } as unknown as TestInfo;
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  baselines = await mkdtemp(join(tmpdir(), 'variance-playwright-test-'));
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent('<main><section id="cart"><h1>Cart</h1><p>Empty</p></section></main>');
});

afterAll(async () => {
  await browser?.close();
  if (baselines !== '') await rm(baselines, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('the additive Playwright path', () => {
  it('observes through the Page and TestInfo the suite already owns', async () => {
    const locator = page!.locator('#cart');
    const accepted = await observe(page!, locator, info('all'), {
      baselines,
      subjectId: 'cart/empty',
    });
    expect(accepted.verdict).toBe('new');

    const unchanged = await observe(page!, locator, info('none'), {
      baselines,
      subjectId: 'cart/empty',
    });
    expect(() => assertUnchanged(unchanged)).not.toThrow();
    expect(unchanged.verdict).toBe('unchanged');
  }, 60_000);
});

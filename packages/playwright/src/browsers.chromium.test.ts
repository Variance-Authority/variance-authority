import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import { leaseBrowser, leaseContext } from './browsers.js';
import { CHROMIUM_RASTER_ARGS } from './renderer.js';

/**
 * The leases every world and renderer of a run share a browser and a context
 * through. Skipped rather than failed when Chromium is not downloaded.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const LAUNCH = { headless: true, args: CHROMIUM_RASTER_ARGS } as const;
const VIEWPORT = { width: 320, height: 240 } as const;

describe.skipIf(!BROWSER_AVAILABLE)('leaseBrowser', () => {
  it('hands every holder of one launch recipe the same browser, and closes it at the last release', async () => {
    const first = await leaseBrowser('chromium', LAUNCH);
    const second = await leaseBrowser('chromium', LAUNCH);
    expect(second.value).toBe(first.value);

    await first.release();
    expect(first.value.isConnected()).toBe(true);
    await second.release();
    expect(first.value.isConnected()).toBe(false);
  });

  it('launches a new browser after the shared one died', async () => {
    const first = await leaseBrowser('chromium', LAUNCH);
    await first.value.close();

    const next = await leaseBrowser('chromium', LAUNCH);
    expect(next.value).not.toBe(first.value);
    expect(next.value.isConnected()).toBe(true);
    await next.release();
    await first.release();
  });
});

describe.skipIf(!BROWSER_AVAILABLE)('leaseContext', () => {
  it("hands pages opened with the same options one context, so the second is served from the first one's cache", async () => {
    const browser = await leaseBrowser('chromium', LAUNCH);
    try {
      const first = await leaseContext(browser.value, { viewport: VIEWPORT });
      const second = await leaseContext(browser.value, { viewport: VIEWPORT });
      const other = await leaseContext(browser.value, { viewport: { width: 640, height: 480 } });
      expect(second.value).toBe(first.value);
      expect(other.value).not.toBe(first.value);

      await first.release();
      expect(browser.value.contexts()).toContain(second.value);
      await second.release();
      expect(browser.value.contexts()).not.toContain(second.value);

      const again = await leaseContext(browser.value, { viewport: VIEWPORT });
      expect(again.value).not.toBe(first.value);
      await again.release();
      await other.release();
    } finally {
      await browser.release();
    }
  });
});

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\n@variance-authority/playwright (browsers): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

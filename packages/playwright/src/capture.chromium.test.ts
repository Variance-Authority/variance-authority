import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Viewport } from '@variance-authority/core/format';
import { MAX_CAPTURE_PIXELS, captureSubject, outward } from './capture.js';

/**
 * The fast capture path, held to the only bar that matters: the same bytes.
 *
 * `captureSubject` exists to skip Playwright's two-frame actionability wait,
 * which is most of a light subject's cost. The risk it carries is not a crash —
 * it is a capture that works, is faster, and is one pixel different, which would
 * re-record every baseline a user owns while every test still passed. So each
 * case here asserts against `locator.screenshot()` itself rather than against a
 * recorded fixture: the incumbent path is the oracle.
 *
 * The fallbacks are asserted the same way. A subject that must take the slow path
 * still has to come back with correct pixels, and a predicate that quietly
 * refused everything would pass a byte-equality test while buying nothing — so
 * the timings in `capture.ts` name what the fast path is worth, and these cases
 * name when it is allowed to run.
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
    '\npackages/playwright (capture): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const VIEWPORT: Viewport = {
  width: 800,
  height: 600,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

const SHOT = { type: 'png' } as const;

/** The subject carries the attribute the renderer marks its root with. */
const document_ = (style: string, before = ''): string =>
  `<!doctype html><meta name="color-scheme" content="light">
<style>html,body{margin:0;background:#fff}
#s{box-sizing:border-box;background:#fff;border:1px solid #ccc;font:15px/1.5 sans-serif;padding:8px;${style}}
i{display:inline-block;width:20px;height:20px;margin:1px;border-radius:5px;
  background:linear-gradient(135deg,#e0303a,#3050e0);box-shadow:0 2px 5px rgba(0,0,0,.4)}</style>
${before}<div id="s" data-va-path="0">Subject${'<i></i>'.repeat(24)}</div>`;

describe.skipIf(!BROWSER_AVAILABLE)('captureSubject', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await (await browser.newContext(VIEWPORT)).newPage();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  /** What `locator.screenshot()` returns for the same document, for comparison. */
  const incumbent = async (html: string): Promise<Buffer> => {
    await page.setContent(html);
    return page.locator('[data-va-path="0"]').screenshot(SHOT);
  };

  const both = async (html: string): Promise<{ fast: Buffer; slow: Buffer }> => {
    // The element shot second: it scrolls, and doing it first would hand the
    // clip a scroll position it did not ask for — which is how an earlier
    // version of this measurement fooled itself.
    await page.setContent(html);
    const { bytes } = await captureSubject(page, VIEWPORT, SHOT);
    return { fast: bytes!, slow: await incumbent(html) };
  };

  it.each([
    ['integer box at the origin', 'width:420px;height:300px'],
    ['fractional size', 'width:420.37px;height:300.61px'],
    ['integer size at a fractional offset', 'width:420px;height:300px;margin:10.4px 0 0 7.3px'],
    ['both fractional', 'width:333.33px;height:222.22px;margin:3.7px 0 0 11.9px'],
    ['em-sized', 'width:26.3em;height:18.7em'],
    ['scaled', 'width:300px;height:200px;transform:scale(1.13);transform-origin:0 0'],
    ['exactly the viewport', 'width:800px;height:600px'],
  ])('is byte-identical to the element path: %s', async (_name, style) => {
    const { fast, slow } = await both(document_(style));
    expect(fast.equals(slow)).toBe(true);
  });

  it.each([
    ['wider than the viewport', 'width:801px;height:300px', ''],
    ['taller than the viewport', 'width:420px;height:601px', ''],
    ['rotated, so the box is not the captured rectangle', 'width:300px;height:200px;transform:rotate(0.5deg)', ''],
    ['below the fold, where a clip rect may not reach', 'width:420px;height:300px', '<div style="height:900px"></div>'],
  ])('falls back and still returns the element path bytes: %s', async (_name, style, before) => {
    const html = document_(style, before);
    const { fast, slow } = await both(html);
    expect(fast.equals(slow)).toBe(true);
  });

  it('reports the box alongside the bytes', async () => {
    await page.setContent(document_('width:420px;height:300px'));
    const { box } = await captureSubject(page, VIEWPORT, SHOT);
    expect(box).toEqual({ x: 0, y: 0, width: 420, height: 300 });
  });

  /**
   * A subject with no pixels is decided here rather than left to a screenshot.
   *
   * Both paths refuse it, and both refuse it slowly and in their own terms: the
   * clip path complains about `options.clip.height`, and `locator.screenshot()`
   * spends Playwright's full 30-second actionability timeout waiting for the
   * element to become visible first. The renderer names the subject instead, and
   * it can only do that if nothing has already thrown.
   */
  it.each([
    ['display:none, which has no box at all', 'display:none'],
    ['a zero height, which has a box with no area', 'width:420px;height:0'],
    ['a zero width', 'width:0;height:300px'],
  ])('returns no bytes and no box: %s', async (_name, style) => {
    // Written out rather than through `document_`, whose subject has a border
    // and `box-sizing: border-box` — which floors its height at the border box
    // and makes a zero side unreachable.
    await page.setContent(`<!doctype html><div data-va-path="0" style="${style}">s</div>`);
    expect(await captureSubject(page, VIEWPORT, SHOT)).toEqual({ bytes: null, box: null });
  }, 10_000);

  /**
   * A subject past the ceiling is refused, not photographed and not clipped.
   *
   * A clipped image claims a review of pixels nobody saw, and an image tens of
   * thousands of pixels tall is not one a person reviews. Measured in device
   * pixels, so the same subject at a higher scale factor reaches it sooner.
   */
  it.each([
    ['taller than the ceiling', 'width:420px;height:17000px', VIEWPORT, 17000],
    ['under it in CSS pixels, over it in device pixels', 'width:420px;height:9000px', { ...VIEWPORT, deviceScaleFactor: 2 }, 18000],
    ['wider than the ceiling', 'width:17000px;height:20px', VIEWPORT, 17000],
  ])('refuses a subject %s, naming its size and the ceiling', async (_name, style, viewport, pixels) => {
    await page.setContent(document_(style));
    await expect(captureSubject(page, viewport, SHOT)).rejects.toThrow(
      new RegExp(`${pixels}.*${MAX_CAPTURE_PIXELS}`),
    );
  }, 10_000);

  it('photographs a subject exactly at the ceiling', async () => {
    await page.setContent(document_(`width:420px;height:${MAX_CAPTURE_PIXELS}px`));
    const { box } = await captureSubject(page, VIEWPORT, SHOT);
    expect(box?.height).toBe(MAX_CAPTURE_PIXELS);
  }, 30_000);

});

describe('outward', () => {
  it('snaps the near edge down and the far edge up', () => {
    expect(outward({ x: 7.3, y: 10.4, width: 420, height: 300 })).toEqual({
      x: 7,
      y: 10,
      width: 421,
      height: 301,
    });
  });

  it('leaves a box already on the grid alone', () => {
    expect(outward({ x: 0, y: 0, width: 420, height: 300 })).toEqual({
      x: 0,
      y: 0,
      width: 420,
      height: 300,
    });
  });

  /**
   * The mistake this rule exists to avoid: rounding the extent rather than the
   * far edge. A 420-wide box at x=7.3 spans 7.3 to 427.3 and touches 421 columns
   * of pixels, not 420.
   */
  it('does not round the extent, which would lose a column', () => {
    const snapped = outward({ x: 7.3, y: 0, width: 420, height: 300 });
    expect(snapped.width).not.toBe(Math.round(420));
    expect(snapped.width).toBe(421);
  });
});

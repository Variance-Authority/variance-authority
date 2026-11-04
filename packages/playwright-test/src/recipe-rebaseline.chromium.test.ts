import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Page, type TestInfo } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RenderDocument, RenderIdentity } from '@variance-authority/core/format';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import type { Renderer } from '@variance-authority/raster';
import { CHROMIUM_RASTER_ARGS, createVariance } from './index.js';

/**
 * `--update-snapshots` after an upgrade that moved the recipe.
 *
 * Deferred capture settles before it renders, and a baseline under an older
 * recipe is compared anyway, with the recipe named as the cause (ADR-0090). The
 * flag adopts a change under a moved recipe as it adopts any change, so the
 * settlement has to paint: a refusal there would return before anything reached
 * `promote`, and the flag would adopt nothing.
 */

/**
 * Every call to the encoder an accept keeps its baseline with. The wrapper
 * passes the bytes through, so the tests below see the real encode; the last
 * one reads the count. About 99% of runs change no pixel, so an encode on that
 * path would be paid on almost every run for nothing.
 */
const encodes = vi.hoisted(() => ({ count: 0 }));

vi.mock('@variance-authority/png-sharp', async (original) => {
  const real = await original<typeof import('@variance-authority/png-sharp')>();
  return {
    ...real,
    keepImage: async (bytes: Buffer) => {
      encodes.count += 1;
      return real.keepImage(bytes);
    },
  };
});

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

let browser: Browser | undefined;
let page: Page | undefined;
let renderer: Renderer | undefined;
let baselines = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  baselines = await mkdtemp(join(tmpdir(), 'variance-playwright-recipe-'));
  browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
  page = await browser.newPage({ viewport: { width: 400, height: 300 } });
  renderer = await createPlaywrightRenderer();
});

afterAll(async () => {
  await renderer?.close();
  await browser?.close();
  if (baselines !== '') await rm(baselines, { recursive: true, force: true });
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test recipe re-baseline: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/** Playwright's `--update-snapshots` modes this file runs under. */
type Update = 'all' | 'changed' | 'none';

function info(updateSnapshots: Update): TestInfo {
  return {
    titlePath: ['recipe re-baseline', 'cart'],
    config: { updateSnapshots },
    project: { use: { colorScheme: 'light', deviceScaleFactor: 1 } },
  } as unknown as TestInfo;
}

/** The real renderer, stamping the rasterization digest an older or newer release would. */
function underRecipe(inner: Renderer, rasterization: string): Renderer {
  const stamp = (identity: RenderIdentity): RenderIdentity => ({ ...identity, rasterization });
  return {
    identity: stamp(inner.identity),
    identityFor: (document: RenderDocument) => stamp(inner.identityFor(document)),
    render: async (document: RenderDocument) => {
      const raster = await inner.render(document);
      return { ...raster, identity: stamp(raster.identity) };
    },
    close: async () => {},
  };
}

async function observeCart(
  rasterization: string,
  updateSnapshots: Update,
  subjectId = 'cart/recipe',
) {
  const session = await createVariance(page!, info(updateSnapshots), {
    baselines,
    renderer: underRecipe(renderer!, rasterization),
  });
  try {
    return await session.observe(page!.locator('#cart'), { subjectId });
  } finally {
    await session.close();
  }
}

chromium_('deferred capture after a recipe-only upgrade', () => {
  it('adopts the new image under --update-snapshots, and compares against it afterwards', async () => {
    await page!.setContent('<main><section id="cart"><h1>Cart</h1><p>Empty</p></section></main>');

    // The baseline an older release wrote, then the same machine under the
    // recipe digest 3fdec678 moved to.
    await observeCart('v1:8040e1a2e35d148b301ebd30e5ed66c6', 'all');
    const adopted = await observeCart('v1:54323cded938fde38b41cdd3865368fe', 'all');
    expect(adopted.because).toContain('accepted under --update-snapshots');
    expect(adopted.because).toContain('rasterization e5ed66c6 → 865368fe');

    const compared = await observeCart('v1:54323cded938fde38b41cdd3865368fe', 'none');
    expect(compared.verdict).toBe('unchanged');
  }, 60_000);

  it('adopts a moved document under =changed, naming the recipe that moved with it', async () => {
    // The recipe moved and so did the cart. The pair is compared, the change is
    // a change, and `=changed` adopts it the way `variance accept --all` does.
    const old = 'v1:8040e1a2e35d148b301ebd30e5ed66c6';
    const recipe = 'v1:54323cded938fde38b41cdd3865368fe';
    await page!.setContent('<main><section id="cart"><h1>Cart</h1><p>Empty</p></section></main>');
    await observeCart(old, 'all', 'cart/moved');

    await page!.setContent('<main><section id="cart"><h1>Cart</h1><p>3 items</p></section></main>');
    const adopted = await observeCart(recipe, 'changed', 'cart/moved');
    expect(adopted.because).toContain('accepted under --update-snapshots');
    expect(adopted.because).toContain('rasterization e5ed66c6 → 865368fe');
    expect((await observeCart(recipe, 'none', 'cart/moved')).verdict).toBe('unchanged');
  }, 60_000);
});

chromium_('a kept baseline', () => {
  it('is encoded when it is accepted, and not again by a run that changed no pixel', async () => {
    await page!.setContent('<main><section id="cart"><h1>Cart</h1><p>Empty</p></section></main>');
    const recipe = 'v1:54323cded938fde38b41cdd3865368fe';
    const before = encodes.count;
    await observeCart(recipe, 'all', 'cart/kept');
    const kept = encodes.count - before;

    // The document moves and no pixel does, so each run below paints and
    // compares rather than settling on the document alone.
    await page!.setContent('<main><section id="cart" data-revision="2"><h1>Cart</h1><p>Empty</p></section></main>');
    const compared = await observeCart(recipe, 'none', 'cart/kept');
    const accepting = await observeCart(recipe, 'all', 'cart/kept');

    expect({ kept, compared: compared.verdict, accepting: accepting.verdict, again: encodes.count - before - kept }).toEqual({
      kept: 1,
      compared: 'unchanged',
      accepting: 'unchanged',
      again: 0,
    });
  }, 60_000);
});

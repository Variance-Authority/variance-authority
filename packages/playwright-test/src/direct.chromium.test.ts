import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RenderDocument } from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import {
  assertUnchanged,
  CHROMIUM_RASTER_ARGS,
  createVariance,
  observe,
} from './index.js';

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
  browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
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

// Top level on purpose: `chromium_` is `describe.skip` without a browser, and a
// todo inside a skipped block is counted as skipped rather than as a gap.
it.todo(
  'a spec reaches the wiring band and a holding through `variance(locator)` — the readers and the request that carries them are asserted over the route path in `packages/route-collector/src/wiring.chromium.test.ts`, and all three page agents pass the same two into `collect`, so what is untested here is only this driver; needs a React mount in this suite, and this package declares neither the react nor the vite devDependency that makes one',
);

chromium_('the additive Playwright path', () => {
  it('reports a browser ARIA change whose pixels remain identical', async () => {
    await page!.setContent('<button id="pay" aria-label="Pay now">$12</button>');
    const locator = page!.locator('#pay');

    await observe(page!, locator, info('all'), {
      baselines,
      subjectId: 'button/aria-only',
    });
    await locator.evaluate((element) => element.setAttribute('aria-label', 'Submit payment'));

    const changed = await observe(page!, locator, info('none'), {
      baselines,
      subjectId: 'button/aria-only',
    });

    expect(changed).toMatchObject({
      verdict: 'changed',
      signals: {
        pixels: 'unchanged',
        accessibility: { verdict: 'changed' },
      },
    });
    expect(changed.signals?.accessibility?.before?.roots[0]).toContain('Pay now');
    expect(changed.signals?.accessibility?.after?.roots[0]).toContain('Submit payment');
  }, 60_000);

  it('observes through the Page and TestInfo the suite already owns', async () => {
    await page!.setContent('<main><section id="cart"><h1>Cart</h1><p>Empty</p></section></main>');
    const locator = page!.locator('#cart');
    const accepted = await observe(page!, locator, info('all'), {
      baselines,
      subjectId: 'cart/empty',
    });
    // The run the README tells an adopter to make. It promoted the candidate, so
    // it passes its own assertion — a first baseline that could only be
    // established by a failing run is a documented command nobody can put in CI.
    expect(() => assertUnchanged(accepted)).not.toThrow();
    expect(accepted.verdict).toBe('unchanged');
    expect(accepted.because).toContain('accepted under --update-snapshots');
    expect(accepted.because).toContain('cart/empty');

    const unchanged = await observe(page!, locator, info('none'), {
      baselines,
      subjectId: 'cart/empty',
    });
    expect(() => assertUnchanged(unchanged)).not.toThrow();
    expect(unchanged.verdict).toBe('unchanged');
  }, 60_000);

  it('captures in place without calling an injected renderer', async () => {
    let rendererCalls = 0;
    const poison: Renderer = {
      identity: {
        renderer: 'must-not-run',
        engine: 'must-not-run',
        platform: 'must-not-run',
        deviceScaleFactor: 1,
        fonts: [],
      },
      identityFor(_document: RenderDocument) {
        rendererCalls += 1;
        return this.identity;
      },
      async render() {
        rendererCalls += 1;
        throw new Error('in-place capture called the deferred renderer');
      },
      async close() {},
    };
    const materialization = {
      kind: 'in-place',
      browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
    } as const;
    const session = await createVariance(page!, info('all'), {
      baselines,
      renderer: poison,
      materialization,
    });

    try {
      const first = await session.observe(page!.locator('#cart'), {
        subjectId: 'cart/in-place',
      });
      const second = await session.observe(page!.locator('#cart'), {
        subjectId: 'cart/in-place',
      });

      // Both `unchanged`, for different reasons: the first because it was
      // accepted, the second because it was compared.
      expect(first.verdict).toBe('unchanged');
      expect(first.because).toContain('accepted under --update-snapshots');
      expect(second.verdict).toBe('unchanged');
      expect(second.because).not.toContain('accepted');
      expect(second.rendered).toBe(false);
      expect(rendererCalls).toBe(0);
    } finally {
      await session.close();
    }

    const changedIdentity = await createVariance(page!, info('none'), {
      baselines,
      materialization: {
        kind: 'in-place',
        browser: { headless: true, launchArgs: ['--disable-lcd-text'] },
      },
    });
    try {
      const incomparable = await changedIdentity.observe(page!.locator('#cart'), {
        subjectId: 'cart/in-place',
      });
      expect(incomparable.verdict).toBe('incomparable');
    } finally {
      await changedIdentity.close();
    }
  }, 60_000);

  it('refuses an in-place image that changes between stability reads', async () => {
    const target = page!.locator('#cart');
    let screenshots = 0;
    const changing = new Proxy(target, {
      get(locator, property) {
        if (property === 'screenshot') {
          return async (options: Parameters<Locator['screenshot']>[0]) => {
            screenshots += 1;
            await locator.evaluate((element, index) => {
              (element as HTMLElement).style.backgroundColor = index % 2 === 0 ? 'blue' : 'red';
            }, screenshots);
            return locator.screenshot(options);
          };
        }
        const value = Reflect.get(locator, property);
        return typeof value === 'function' ? value.bind(locator) : value;
      },
    });
    const session = await createVariance(page!, info('none'), {
      baselines,
      materialization: {
        kind: 'in-place',
        browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
      },
    });

    try {
      await expect(
        session.observe(changing, { subjectId: 'cart/in-place-unstable' }),
      ).rejects.toThrow('repeated screenshots disagree');
      expect(screenshots).toBe(2);
    } finally {
      await target.evaluate((element) => {
        (element as HTMLElement).style.removeProperty('background-color');
      });
      await session.close();
    }
  }, 60_000);

  it('refuses a stable image acquired from stale semantics', async () => {
    const target = page!.locator('#cart');
    let screenshots = 0;
    const mutating = new Proxy(target, {
      get(locator, property) {
        if (property === 'screenshot') {
          return async (options: Parameters<Locator['screenshot']>[0]) => {
            screenshots += 1;
            if (screenshots === 1) {
              await locator.evaluate((element) => {
                element.querySelector('p')!.textContent = 'One item';
              });
            }
            return locator.screenshot(options);
          };
        }
        const value = Reflect.get(locator, property);
        return typeof value === 'function' ? value.bind(locator) : value;
      },
    });
    const session = await createVariance(page!, info('none'), {
      baselines,
      materialization: {
        kind: 'in-place',
        browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
      },
    });

    try {
      await expect(
        session.observe(mutating, { subjectId: 'cart/in-place-stale-semantics' }),
      ).rejects.toThrow('changed between acquisition and screenshots');
      expect(screenshots).toBe(2);
    } finally {
      await target.locator('p').evaluate((element) => {
        element.textContent = 'Empty';
      });
      await session.close();
    }
  }, 60_000);

  it('uses the acquisition animation hold for both semantics and pixels', async () => {
    const target = page!.locator('#cart');
    await target.evaluate((element) => {
      (element as HTMLElement).style.animation = 'variance-pulse 10ms linear infinite';
      const style = document.createElement('style');
      style.dataset.varianceTest = 'animation';
      style.textContent = '@keyframes variance-pulse{from{opacity:.2}to{opacity:1}}';
      document.head.append(style);
    });
    const session = await createVariance(page!, info('all'), {
      baselines,
      materialization: {
        kind: 'in-place',
        browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
      },
    });

    try {
      const first = await session.observe(target, { subjectId: 'cart/in-place-animation' });
      const second = await session.observe(target, { subjectId: 'cart/in-place-animation' });
      // Two `unchanged` verdicts is the whole assertion: the second compared an
      // animating subject against the first and found the same pixels.
      expect(first.because).toContain('accepted under --update-snapshots');
      expect(second.verdict).toBe('unchanged');
    } finally {
      await target.evaluate((element) => {
        (element as HTMLElement).style.removeProperty('animation');
        document.querySelector('style[data-variance-test="animation"]')?.remove();
      });
      await session.close();
    }
  }, 60_000);
});

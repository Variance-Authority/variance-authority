import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type Locator, type Page, type TestInfo } from '@playwright/test';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CHROMIUM_RASTER_ARGS, createVariance } from './index.js';

/**
 * The in-place guard's page half: what the subject did while its screenshots
 * were taken, which the reads on either side of them cannot see.
 */

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

const materialization = {
  kind: 'in-place',
  browser: { headless: true, launchArgs: CHROMIUM_RASTER_ARGS },
} as const;

function info(updateSnapshots: 'all' | 'none'): TestInfo {
  return {
    titlePath: ['in-place watch', 'cart'],
    config: { updateSnapshots },
    project: { use: { colorScheme: 'light', deviceScaleFactor: 1 } },
  } as unknown as TestInfo;
}

/** `target`, with `during` run around its screenshots: the first argument is which one. */
function around(
  target: Locator,
  during: (screenshot: number, phase: 'before' | 'after') => Promise<void>,
): Locator {
  let screenshots = 0;
  return new Proxy(target, {
    get(locator, property) {
      if (property === 'screenshot') {
        return async (options: Parameters<Locator['screenshot']>[0]) => {
          screenshots += 1;
          await during(screenshots, 'before');
          const bytes = await locator.screenshot(options);
          await during(screenshots, 'after');
          return bytes;
        };
      }
      const value = Reflect.get(locator, property);
      return typeof value === 'function' ? value.bind(locator) : value;
    },
  });
}

async function accept(target: Locator, subjectId: string): Promise<void> {
  const accepting = await createVariance(page!, info('all'), { baselines, materialization });
  try {
    await accepting.observe(target, { subjectId });
  } finally {
    await accepting.close();
  }
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  baselines = await mkdtemp(join(tmpdir(), 'variance-playwright-test-watch-'));
  browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
  page = await browser.newPage({ viewport: { width: 800, height: 600 } });
});

beforeEach(async () => {
  await page?.setContent(
    '<main><section id="cart" data-state="idle"><h1>Cart</h1><p>Empty</p></section></main>',
  );
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

chromium_('the in-place watch', () => {
  it('does not photograph a state the reads on both sides of the screenshots never saw', async () => {
    // A→B→A inside the capture window: B lands before the first screenshot and
    // is gone again before the confirming acquisition, so both images agree and
    // both DOM reads agree, and only the photograph ever held B.
    const target = page!.locator('#cart');
    await accept(target, 'cart/in-place-flicker');
    // Put back exactly as it was read, so the confirming read cannot tell.
    const text = target.locator('p');
    const was = await text.evaluate((element) => element.textContent ?? '');
    const flickering = around(target, async (screenshot, phase) => {
      if (screenshot === 1 && phase === 'before') {
        await text.evaluate((element) => (element.textContent = 'One item'));
      }
      if (screenshot === 2 && phase === 'after') {
        await text.evaluate((element, back) => (element.textContent = back), was);
      }
    });
    const session = await createVariance(page!, info('none'), { baselines, materialization });

    try {
      const observation = await session.observe(flickering, { subjectId: 'cart/in-place-flicker' });
      expect(observation.verdict).toBe('unchanged');
    } finally {
      await text.evaluate((element, back) => (element.textContent = back), was);
      await session.close();
    }
  }, 60_000);

  it('reads a subject that writes the values it already holds as still', async () => {
    // A timer that sets the same attribute and the same text on every tick
    // changes nothing the reads or the images could show, so it is no reason to
    // refuse. Written twice per screenshot, so a run of identical writes is
    // covered as well as one.
    const target = page!.locator('#cart');
    await accept(target, 'cart/in-place-same-value');
    const rewriting = around(target, async () => {
      await target.evaluate((section) => {
        const text = section.querySelector('p')!.firstChild as Text;
        for (let tick = 0; tick < 2; tick += 1) {
          section.setAttribute('data-state', 'idle');
          text.data = 'Empty';
        }
      });
    });
    const session = await createVariance(page!, info('none'), { baselines, materialization });

    try {
      const observation = await session.observe(rewriting, { subjectId: 'cart/in-place-same-value' });
      expect(observation.verdict).toBe('unchanged');
    } finally {
      await session.close();
    }
  }, 60_000);

  it('refuses an attribute set to another value and back between the reads', async () => {
    // The same flicker as the text one, through `characterData`'s sibling: two
    // records for one attribute, whose first old value matches the value now.
    const target = page!.locator('#cart');
    await accept(target, 'cart/in-place-attribute-flicker');
    const flickering = around(target, async (screenshot, phase) => {
      if (screenshot === 1 && phase === 'before') {
        await target.evaluate((section) => section.setAttribute('data-state', 'busy'));
      }
      if (screenshot === 2 && phase === 'after') {
        await target.evaluate((section) => section.setAttribute('data-state', 'idle'));
      }
    });
    const session = await createVariance(page!, info('none'), {
      baselines,
      materialization: { ...materialization, settleAttempts: 1 },
    });

    try {
      await expect(
        session.observe(flickering, { subjectId: 'cart/in-place-attribute-flicker' }),
      ).rejects.toThrow(
        'in-place capture for cart/in-place-attribute-flicker changed while the page was being ' +
          'photographed and changed back before it was read again — the page changed the ' +
          '`data-state` attribute of `section#cart` (1 attempt)',
      );
    } finally {
      await session.close();
    }
  }, 60_000);
});

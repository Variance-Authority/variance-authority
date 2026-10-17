import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { storybookCollector } from '@variance-authority/storybook-collector';

/**
 * A run with workers spends one browser, one boot per worker, and one fetch per asset.
 *
 * A worker is a page, not a browser. The preview it boots is the expensive part
 * of a Storybook run: on a large build it is tens of megabytes of scripts and a
 * second or two of evaluation, and every launch, context or reload a worker
 * takes on top of that is paid again per worker. So this opens the run the way
 * `variance run` does — the collector's own world, then a world per worker, then
 * the renderer — and counts what the browser did:
 *
 * - **launches**, through Playwright's own `chromium.launch`: one, shared by the
 *   collector's worlds and the renderer;
 * - **boots**, as `load` events per page: one per worker page, and no reload;
 * - **fetches**, as Resource Timing entries that crossed the wire
 *   (`transferSize > 0`) for the preview's scripts and stylesheets: once per
 *   path across every worker, the later workers answered by the first one's
 *   cache.
 *
 * Counts, not timings: each one is exact on any machine.
 *
 * Skipped, loudly, without a build or a browser.
 */

const ROOT = join(process.cwd(), 'cases', 'storybook-case');
const INDEX = join(ROOT, 'storybook-static', 'index.json');

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const READY = existsSync(INDEX) && BROWSER_AVAILABLE;

if (!READY) {
  console.warn(
    '\ncases/storybook-case (one browser): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(INDEX)
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook') +
      '\n',
  );
}

const CONFIG = {
  viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
  subjects: { index: INDEX },
};

const story = (id) => ({ subject: { id: `story:${id}`, kind: 'story' } });

/** Every browser Playwright launched while the run was open. */
const launched = [];
/** `load` events per page, for every page any of those browsers opened. */
const loads = new Map();

let collector;
let workers = [];
let renderer;
let readings = [];
/** Per preview path, how many pages fetched it over the wire. */
let fetched = new Map();

beforeAll(async () => {
  if (!READY) return;

  // Counted at Playwright's own entry point, so every launch the collector and
  // the renderer make is seen, by whichever module makes it.
  const launch = chromium.launch.bind(chromium);
  vi.spyOn(chromium, 'launch').mockImplementation(async (options) => {
    const browser = await launch(options);
    launched.push(browser);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (contextOptions) => {
      const context = await newContext(contextOptions);
      context.on('page', (page) => {
        loads.set(page, 0);
        page.on('load', () => loads.set(page, loads.get(page) + 1));
      });
      return context;
    };
    return browser;
  });

  collector = await storybookCollector({})({ config: CONFIG });
  // As `openLanes` opens them: the run's own world first, then one at a time.
  workers = [await collector.openWorker(), await collector.openWorker()];
  renderer = await createPlaywrightRenderer({});

  readings = [
    await collector.collect(story('case-surface--button-primary')),
    await workers[0].collect(story('case-surface--card-with-actions')),
    await workers[1].collect(story('case-surface--composed')),
  ];

  for (const browser of launched) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.url().includes('/iframe.html')) continue;
        const crossed = await page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .filter((entry) => ['script', 'link', 'css', 'other'].includes(entry.initiatorType))
            .filter((entry) => entry.transferSize > 0)
            .map((entry) => new URL(entry.name).pathname),
        );
        for (const path of new Set(crossed)) fetched.set(path, (fetched.get(path) ?? 0) + 1);
      }
    }
  }
}, 120_000);

/** Closes what is still open: the last tests close in order, and a failure stops them. */
async function closeRun() {
  for (const worker of workers.splice(0)) await worker.close();
  await collector?.close();
  collector = undefined;
}

afterAll(async () => {
  await renderer?.close();
  await closeRun();
  vi.restoreAllMocks();
});

const live = READY ? describe : describe.skip;

live('a run with two workers and a renderer', () => {
  it('reads every story it was asked for', () => {
    // The premise: a world that shares a browser and still reads nothing would
    // pass every count below.
    for (const reading of readings) expect(reading.ok, reading.because).toBe(true);
  });

  it('launches one browser', () => {
    expect(launched).toHaveLength(1);
  });

  it('boots each worker page once and never reloads it', () => {
    const previews = [...loads].filter(([page]) => page.url().includes('/iframe.html'));
    expect(previews).toHaveLength(3);
    for (const [, count] of previews) expect(count).toBe(1);
  });

  it('fetches each preview script and stylesheet once across the workers', () => {
    expect(fetched.size).toBeGreaterThan(0);
    const repeated = [...fetched].filter(([, count]) => count > 1);
    expect(repeated).toEqual([]);
  });

  it('keeps the browser while anything still holds it', async () => {
    await renderer.close();
    renderer = undefined;
    expect(launched[0].isConnected()).toBe(true);
  });

  it('closes the browser once the last holder lets go', async () => {
    await closeRun();
    expect(launched[0].isConnected()).toBe(false);
  });
});

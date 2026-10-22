import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { animatedGif, solidPng } from './network.fixture.js';
import { observeNetwork, type NetworkObservation } from './network.js';

/**
 * An animated GIF, held still on the wire.
 *
 * The unit tests beside `freezeGif` assert on bytes: that a single-frame prefix
 * plus a trailer is what comes back. Chromium checks that the intercepted
 * response decodes, and the observer reports which URL it froze. Neither check
 * depends on sampling the GIF's animation phase.
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
    '\npackages/playwright (network): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const GIF = animatedGif();
const HERO = solidPng(120, 90);
const ICON = solidPng(16, 16);

const PAGE = `<!doctype html><html><body style="margin:0">
  <img id="spinner" src="/spinner.gif" width="64" height="64" style="image-rendering:pixelated">
</body></html>`;

/**
 * Neither image is given a width, which is the whole point.
 *
 * An `<img>` with no CSS size lays out at its *intrinsic* size, so this page's
 * height is a fact about the bytes. A substitution that returned a 1×1
 * transparent pixel would collapse it and the run would report a layout
 * regression this tool had caused.
 */
const IMAGES_PAGE = `<!doctype html><html><body style="margin:0;background:#fff">
  <img id="hero" src="/art/hero.png">
  <img id="chevron" src="/icons/chevron.png">
</body></html>`;

/**
 * A page that asks for three things after it loads: one it shows, and two it
 * only guesses it might show next, as a router prefetching its links does.
 */
const SPECULATING_PAGE = `<!doctype html><html><head>
  <link rel="prefetch" href="/guessed/link">
</head><body>
  <script>
    fetch('/shown');
    fetch('/guessed/router', { headers: { 'Next-Router-Prefetch': '1' } }).catch(() => {});
  </script>
</body></html>`;

/** Two cacheable images, one of them animated, and a guess at what comes next. */
const CACHING_PAGE = `<!doctype html><html><head><link rel="prefetch" href="/guessed/cached"></head><body>
  <img id="hero" src="/cached/hero.png"><img id="spinner" src="/cached/spinner.gif">
</body></html>`;

let server: Server | undefined;
/**
 * A page or context per test, never per subject. What each test reads is the
 * network its navigations make, so a load is the subject: the cache tests open
 * a second page to be answered by the first one's fetches, and the browser is
 * launched once for the file.
 */
let browser: Browser | undefined;
let base = '';
const served: string[] = [];
// Held open and never answered, so "still in flight" is a state the test holds.
const withheld: import('node:http').ServerResponse[] = [];
let withheldArrived: () => void = () => {};

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = request.url ?? '/';
    served.push(path);

    if (path.startsWith('/withheld.png')) {
      withheld.push(response);
      withheldArrived();
      return;
    }
    // The same bytes as their uncached twins, under a header that lets the
    // browser keep them.
    if (path.startsWith('/cached/')) {
      const gif = path.endsWith('.gif');
      response
        .writeHead(200, { 'content-type': gif ? 'image/gif' : 'image/png', 'cache-control': 'max-age=3600' })
        .end(gif ? GIF : HERO);
      return;
    }
    if (path.startsWith('/spinner.gif')) {
      response.writeHead(200, { 'content-type': 'image/gif' }).end(GIF);
      return;
    }
    if (path.startsWith('/art/hero.png')) {
      response.writeHead(200, { 'content-type': 'image/png' }).end(HERO);
      return;
    }
    if (path.startsWith('/icons/chevron.png')) {
      response.writeHead(200, { 'content-type': 'image/png' }).end(ICON);
      return;
    }

    const pages: readonly (readonly [string, () => string])[] = [
      ['/withholding', () => '<!doctype html><html><body><img id="late" src="/withheld.png"></body></html>'],
      ['/images', () => IMAGES_PAGE],
      ['/speculating', () => SPECULATING_PAGE],
      ['/caching', () => CACHING_PAGE],
    ];
    const html = pages.find(([prefix]) => path.startsWith(prefix))?.[1]() ?? PAGE;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });

  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  base = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ headless: true });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  for (const response of withheld) response.destroy();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

// A prefetch is the page guessing what comes next, not what it shows: served,
// it renders another page's code on this page's behalf.
describe.skipIf(!BROWSER_AVAILABLE)('a request the page only speculates on', () => {
  it('never reaches the server, while what the page shows does', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page);
      const shown = page.waitForResponse(`${base}/shown`);
      await page.goto(`${base}/speculating`, { waitUntil: 'load' });
      await shown;
      await page.waitForTimeout(200);
      await network.settle();

      expect(served).toContain('/shown');
      expect(served.filter((path) => path.startsWith('/guessed'))).toEqual([]);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.skipIf(!BROWSER_AVAILABLE)('an image the server never answers', () => {
  it('refuses the read and names the image, rather than reading without it', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page);
      const arrived = new Promise<void>((resolve) => {
        withheldArrived = resolve;
      });
      await page.goto(`${base}/withholding`, { waitUntil: 'domcontentloaded' });
      // The server holds the request, so the observer has it in flight.
      await arrived;

      // The bound is already spent, so the one count decides.
      const refusal = await network.settle(0);

      expect(refusal).toMatch(/1 image, font or media request.*\/withheld\.png/s);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);

  // One page serves a whole Storybook run and is never reset, so the stalled
  // request outlives its story. It was named in that story's refusal; the next
  // story did not start it and is not refused for it.
  it('refuses only the subject that started it, not the next one on the page', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page);
      const arrived = new Promise<void>((resolve) => {
        withheldArrived = resolve;
      });
      await page.goto(`${base}/withholding`, { waitUntil: 'domcontentloaded' });
      await arrived;

      expect(await network.settle(0)).toMatch(/\/withheld\.png/);
      expect(await network.settle(0)).toBeUndefined();
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.skipIf(!BROWSER_AVAILABLE)('an animated GIF, which no CSS reaches', () => {
  it('reports which URLs it froze, rather than freezing silently', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page);
      await page.goto(`${base}/page`, { waitUntil: 'load' });
      await network.settle();

      const decoded = await page.locator('#spinner').evaluate((img) => ({
        width: (img as HTMLImageElement).naturalWidth,
        complete: (img as HTMLImageElement).complete,
      }));
      expect(decoded).toEqual({ width: 8, complete: true });

      // A stabilizer that rewrites an asset and says nothing is a tool that can
      // change a picture the reviewer is looking at with no record that it did.
      expect(network.frozen).toEqual([`${base}/spinner.gif`]);
      expect(network.diagnostics).toEqual([]);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);

  it('leaves a page alone when freezing is off, and still hashes it', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page, { freezeAnimatedImages: false });
      await page.goto(`${base}/page`, { waitUntil: 'load' });
      await network.settle();

      expect(network.frozen).toEqual([]);
      expect(network.assets[`${base}/spinner.gif`]).toMatch(/^v1:[0-9a-f]{32}$/);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});

/**
 * The claim a byte assertion cannot make: a browser accepts this file.
 *
 * `blank.test.ts` proves the writer emits chunks with CRCs an independent
 * implementation agrees with. That is not the same as a decoder taking it, and a
 * PNG Chromium rejects paints nothing *and collapses the box*, which is exactly
 * the failure mode blanking exists to avoid. So the assertions here are the two
 * a compositor can answer: the image still reports its original intrinsic size,
 * and the page is still the same height.
 */
const BLANK_RULES = [{ id: 'illustrations', url: '**/art/**', minPixels: 10_000 }];

async function layout(page: Page): Promise<Record<string, unknown>> {
  return await page.evaluate(() => {
    const hero = document.querySelector('#hero') as HTMLImageElement;
    const chevron = document.querySelector('#chevron') as HTMLImageElement;
    return {
      hero: `${hero.naturalWidth}x${hero.naturalHeight}`,
      heroBox: `${hero.getBoundingClientRect().width}x${hero.getBoundingClientRect().height}`,
      chevron: `${chevron.naturalWidth}x${chevron.naturalHeight}`,
      body: document.body.getBoundingClientRect().height,
    };
  });
}

describe.skipIf(!BROWSER_AVAILABLE)('an image served as nothing', () => {
  it('keeps the layout it would have had, and reports what it removed', async () => {
    const page = await browser!.newPage({ viewport: { width: 400, height: 300 } });

    try {
      const before = await observeNetwork(page);
      await page.goto(`${base}/images`, { waitUntil: 'load' });
      await before.settle();
      const original = await layout(page);
      const painted = await page.locator('#hero').screenshot();
      await before.close();

      const network = await observeNetwork(page, { blank: BLANK_RULES });
      await page.goto(`${base}/images`, { waitUntil: 'load' });
      await network.settle();

      // The dimensions survive the substitution — intrinsic *and* laid out, and
      // the page's own height with them.
      expect(await layout(page)).toEqual(original);
      expect(original.hero).toBe('120x90');

      // …and the pixels do not. Compared against the unblanked run rather than
      // against a colour, so a hero that was accidentally white would not pass.
      expect((await page.locator('#hero').screenshot()).toString('base64')).not.toBe(
        painted.toString('base64'),
      );

      expect(network.blanked).toEqual([
        { url: `${base}/art/hero.png`, rule: 'illustrations', width: 120, height: 90 },
      ]);
      expect(network.diagnostics).toEqual([]);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);

  it('records the blank in the environment key instead of the bytes it threw away', async () => {
    const page = await browser!.newPage({ viewport: { width: 400, height: 300 } });

    try {
      const network = await observeNetwork(page, { blank: BLANK_RULES });
      await page.goto(`${base}/images`, { waitUntil: 'load' });
      await network.settle();

      // The saving: this value does not move when the illustration is re-exported.
      expect(network.assets[`${base}/art/hero.png`]).toBe('blank:illustrations:120x90');
      // The keeping: the chevron is small, so no rule reaches it, and it is
      // hashed like anything else. `^` stays.
      expect(network.assets[`${base}/icons/chevron.png`]).toMatch(/^v1:[0-9a-f]{32}$/);

      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});

// A Storybook run's worker pages share a context so that each boots from what
// the first one fetched. Playwright's routing turns the cache off, so with
// `cache` on the wire is watched another way, and must record the same things.
describe.skipIf(!BROWSER_AVAILABLE)('a page whose context another page already filled', () => {
  it('is answered from the cache, and still records what it was answered', async () => {
    const context = await browser!.newContext({ viewport: { width: 200, height: 200 } });
    const before = served.filter((path) => path === '/cached/hero.png').length;

    try {
      const observed: NetworkObservation[] = [];
      for (const page of [await context.newPage(), await context.newPage()]) {
        const network = await observeNetwork(page, { cache: true });
        await page.goto(`${base}/caching`, { waitUntil: 'load' });
        await network.settle();
        observed.push(network);
      }

      expect(served.filter((path) => path === '/cached/hero.png').length - before).toBe(1);
      for (const network of observed) {
        expect(network.assets[`${base}/cached/hero.png`]).toMatch(/^v1:[0-9a-f]{32}$/);
        expect(network.frozen).toEqual([`${base}/cached/spinner.gif`]);
        expect(network.diagnostics).toEqual([]);
        await network.close();
      }
      expect(observed[1]!.assets).toEqual(observed[0]!.assets);
      expect(served.filter((path) => path.startsWith('/guessed'))).toEqual([]);
    } finally {
      await context.close();
    }
  }, 60_000);

  // The control: the same two pages with the wire watched through routing. If
  // this fetched once too, the test above would show nothing about the cache.
  it('is fetched again by every page when routing holds the requests', async () => {
    const context = await browser!.newContext({ viewport: { width: 200, height: 200 } });
    const before = served.filter((path) => path === '/cached/hero.png').length;

    try {
      for (const page of [await context.newPage(), await context.newPage()]) {
        const network = await observeNetwork(page);
        await page.goto(`${base}/caching`, { waitUntil: 'load' });
        await network.settle();
        await network.close();
      }

      expect(served.filter((path) => path === '/cached/hero.png').length - before).toBe(2);
    } finally {
      await context.close();
    }
  }, 60_000);

  it('names an image the server never answers, and closes with it still open', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page, { cache: true });
      const arrived = new Promise<void>((resolve) => {
        withheldArrived = resolve;
      });
      await page.goto(`${base}/withholding`, { waitUntil: 'domcontentloaded' });
      await arrived;

      expect(await network.settle(0)).toMatch(/1 image, font or media request.*\/withheld\.png/s);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});

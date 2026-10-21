import { createServer, type Server, type ServerResponse } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { animatedGif, solidPng } from './network.fixture.js';
import { observeNetwork, type NetworkObservation } from './network.js';

/**
 * Every target a page's requests come from, reached with the cache on as routing reaches it.
 *
 * Stabilization is on by default, so a target it misses is one whose animation
 * and bytes reach the capture unremarked. Playwright's routing holds the
 * requests of the page, of every frame in it, and of every dedicated worker it
 * starts. The DevTools path hears only the session it is given, so it has to
 * reach the others itself, record them the same way, and let go of one that
 * goes away while it holds a request.
 *
 * Headless shell keeps a cross-site frame in the page's process; a headed
 * window, and any launch with site isolation, gives it a process of its own. So
 * this launches with site isolation, and checks the frame did get one.
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
    '\npackages/playwright (network reach): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const GIF = animatedGif();
const HERO = solidPng(120, 90);
const ICON = solidPng(16, 16);
const BLANK_RULES = [{ id: 'illustrations', url: '**/art/**', minPixels: 10_000 }];

/** `localhost` and `127.0.0.1` are two sites, so the frame runs in a process of its own. */
const FRAMING_PAGE = (frame: string): string => `<!doctype html><html><body style="margin:0">
  <iframe src="${frame}" width="300" height="200"></iframe>
</body></html>`;
const FRAMED_PAGE = `<!doctype html><html><body style="margin:0">
  <img src="/art/hero.png"><img src="/icons/chevron.png"><img src="/spinner.gif">
</body></html>`;

/** A dedicated worker that loads the face its page names, and says when it is done whichever way it went. */
const WORKING_PAGE = `<!doctype html><html><body><script>
  window.workerDone = new Promise((resolve) => {
    const worker = new Worker('/worker.js' + location.search);
    worker.onmessage = () => resolve();
  });
</script></body></html>`;
const WORKER = `const url = new URLSearchParams(location.search).get('face');
const face = new FontFace('worker-face', 'url(' + url + ')');
self.fonts.add(face);
face.load().catch(() => {}).then(() => postMessage('done'));`;

let server: Server | undefined;
/**
 * A page per test, never per subject. What each test reads is the network of
 * one navigation, so the load is the subject and a page that has made it is
 * spent; the browser is launched once for the file.
 */
let browser: Browser | undefined;
let base = '';
/** The same server under the other site's name. */
let otherSite = '';
const withheld: ServerResponse[] = [];
let withheldArrived: () => void = () => {};

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = request.url ?? '/';
    if (path.startsWith('/worker/broken.woff2')) {
      // No answer at all: the connection ends.
      request.socket.destroy();
      return;
    }
    if (path.startsWith('/withheld.png')) {
      withheld.push(response);
      withheldArrived();
      return;
    }
    const bytes: readonly (readonly [string, string, () => Buffer | string])[] = [
      ['/spinner.gif', 'image/gif', () => GIF],
      ['/art/hero.png', 'image/png', () => HERO],
      ['/icons/chevron.png', 'image/png', () => ICON],
      ['/worker/face.woff2', 'font/woff2', () => ICON],
      ['/worker.js', 'text/javascript', () => WORKER],
      ['/working', 'text/html', () => WORKING_PAGE],
      ['/framing-withheld', 'text/html', () => FRAMING_PAGE(`${otherSite}/withholding`)],
      ['/framing', 'text/html', () => FRAMING_PAGE(`${otherSite}/framed`)],
      ['/framed', 'text/html', () => FRAMED_PAGE],
      ['/withholding', 'text/html', () => '<!doctype html><img src="/withheld.png">'],
    ];
    const found = bytes.find(([prefix]) => path.startsWith(prefix));
    if (found === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': found[1] }).end(found[2]());
  });
  const port = await new Promise<number>((resolve) => {
    server!.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      resolve(address === null || typeof address === 'string' ? 0 : address.port);
    });
  });
  base = `http://127.0.0.1:${port}`;
  otherSite = `http://localhost:${port}`;
  browser = await chromium.launch({ headless: true, args: ['--site-per-process'] });
}, 60_000);

afterAll(async () => {
  await browser?.close();
  for (const response of withheld) response.destroy();
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

/** Targets of this type the page's own session can list, at this origin. */
async function targets(page: Page, type: string, origin: string): Promise<number> {
  const session = await page.context().newCDPSession(page);
  const { targetInfos } = (await session.send('Target.getTargets')) as {
    targetInfos: { type: string; url: string }[];
  };
  await session.detach();
  return targetInfos.filter((info) => info.type === type && info.url.startsWith(origin)).length;
}

describe.skipIf(!BROWSER_AVAILABLE)('a frame another site serves', () => {
  async function observed(cache: boolean): Promise<NetworkObservation> {
    const page = await browser!.newPage({ viewport: { width: 400, height: 300 } });
    try {
      const network = await observeNetwork(page, { cache, blank: BLANK_RULES });
      await page.goto(`${base}/framing`, { waitUntil: 'load' });
      await network.settle();
      // The premise: the frame runs out of the page's process. In-process, the
      // page's own session would hear it and this test would pin nothing.
      expect(await targets(page, 'iframe', otherSite)).toBe(1);
      await network.close();
      return network;
    } finally {
      await page.close();
    }
  }

  it('is blanked, frozen and hashed with the cache on as routing does it', async () => {
    const routed = await observed(false);
    const held = await observed(true);

    expect(held.assets[`${otherSite}/art/hero.png`]).toBe('blank:illustrations:120x90');
    expect(held.assets[`${otherSite}/icons/chevron.png`]).toMatch(/^v1:[0-9a-f]{32}$/);
    expect(held.frozen).toEqual([`${otherSite}/spinner.gif`]);
    expect(held.diagnostics).toEqual([]);
    expect({ assets: held.assets, frozen: held.frozen, blanked: held.blanked }).toEqual({
      assets: routed.assets,
      frozen: routed.frozen,
      blanked: routed.blanked,
    });
  }, 60_000);

  it('lets go of a request it holds when the frame is removed, and the next settle reads', async () => {
    const page = await browser!.newPage({ viewport: { width: 400, height: 300 } });
    try {
      const network = await observeNetwork(page, { cache: true });
      const arrived = new Promise<void>((resolve) => {
        withheldArrived = resolve;
      });
      await page.goto(`${base}/framing-withheld`, { waitUntil: 'domcontentloaded' });
      // Held: the server has the request and will never answer it.
      await arrived;
      expect(await targets(page, 'iframe', otherSite)).toBe(1);

      // As a story switch unmounts it.
      await page.evaluate(() => document.querySelector('iframe')!.remove());

      expect(await network.settle()).toBeUndefined();
      expect(network.diagnostics).toEqual([]);
      await network.close();
    } finally {
      await page.close();
    }
  }, 60_000);
});

describe.skipIf(!BROWSER_AVAILABLE)('a dedicated worker the page starts', () => {
  async function observed(cache: boolean, face = '/worker/face.woff2'): Promise<NetworkObservation> {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });
    try {
      const network = await observeNetwork(page, { cache });
      await page.goto(`${base}/working?face=${face}`, { waitUntil: 'load' });
      await page.evaluate(() => (window as unknown as { workerDone: Promise<void> }).workerDone);
      // Settled on every request's end, never on the time it allows.
      expect(await network.settle()).toBeUndefined();
      await network.close();
      return network;
    } finally {
      await page.close();
    }
  }

  it('has its requests hashed with the cache on as routing does it', async () => {
    const routed = await observed(false);
    const held = await observed(true);

    // The premise: routing holds a worker's requests, so the face is in its key.
    expect(routed.assets[`${base}/worker/face.woff2`]).toMatch(/^v1:[0-9a-f]{32}$/);
    expect(held.assets).toEqual(routed.assets);
    expect(held.diagnostics).toEqual([]);
  }, 60_000);

  it('says it could not read a request that fails, as routing does, and settles', async () => {
    const routed = await observed(false, '/worker/broken.woff2');
    const held = await observed(true, '/worker/broken.woff2');

    const codes = (network: NetworkObservation) => network.diagnostics.map(({ code }) => code);
    expect(codes(routed)).toEqual(['asset-not-observed']);
    expect(codes(held)).toEqual(codes(routed));
    expect(held.assets).toEqual({});
  }, 60_000);
});

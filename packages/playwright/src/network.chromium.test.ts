import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { observeNetwork } from './network.js';

/**
 * An animated GIF, held still on the wire, asserted with a camera.
 *
 * The unit tests beside `freezeGif` assert on bytes: that a single-frame prefix
 * plus a trailer is what comes back. Bytes are not the claim. The claim is that
 * a **browser** accepts the truncated file, decodes it, paints it, and keeps
 * painting the same thing a second later — and none of that can be checked
 * without a compositor and a clock.
 *
 * It also cannot be checked with a semantic hash, which is why this suite is
 * here and not in the collector's. A GIF cycling through its frames changes no
 * attribute, no matched rule and no box; it changes pixels. So the assertion is
 * two screenshots.
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

/**
 * Four frames, 8×8, alternating solid black and solid white.
 *
 * Solid and large enough that a screenshot difference is unmissable — the
 * failure this guards against is a freeze that *nearly* works, and a two-pixel
 * image would let one pass. The LZW payload is real: a browser decodes this.
 * With a two-colour table the minimum code size is 2, so clear is 4 and end is
 * 5, and 64 pixels of one index compress to a run of that index's code.
 */
function animatedGif(): Buffer {
  const side = 8;

  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    side, 0x00, side, 0x00,
    0x80, 0x00, 0x00,
    0x00, 0x00, 0x00, // index 0: black
    0xff, 0xff, 0xff, // index 1: white
  ];

  // NETSCAPE2.0, loop forever — so the browser is genuinely animating rather
  // than resting on a last frame, which would let a broken freeze look correct.
  const loop = [
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00,
  ];

  const frame = (index: number): readonly number[] => {
    // Real LZW, and the fiddly part is the code width. With a minimum code size
    // of 2 the stream starts at 3 bits, `clear` is 4, `end` is 5, and the next
    // free dictionary slot is 6 — so after two data codes the next slot is 8 and
    // the decoder switches to 4-bit codes. Emitting everything at 3 bits
    // produces a file that decodes to nothing, which is the failure mode that
    // matters here: a GIF that never paints makes *both* arms of this suite
    // pass, the frozen one vacuously.
    //
    // Re-clearing every two codes keeps the width at 3 forever. It compresses
    // nothing, which is the right trade for a fixture whose bit packing a reader
    // has to be able to check by hand.
    const codes: number[] = [];
    for (let pixel = 0; pixel < side * side; pixel += 2) {
      codes.push(4, index, index);
    }
    codes.push(5);

    const bytes: number[] = [];
    let bits = 0;
    let width = 0;
    for (const code of codes) {
      bits |= code << width;
      width += 3;
      while (width >= 8) {
        bytes.push(bits & 0xff);
        bits >>>= 8;
        width -= 8;
      }
    }
    if (width > 0) bytes.push(bits & 0xff);

    const subBlocks: number[] = [];
    for (let at = 0; at < bytes.length; at += 255) {
      const slice = bytes.slice(at, at + 255);
      subBlocks.push(slice.length, ...slice);
    }
    subBlocks.push(0x00);

    return [
      0x21, 0xf9, 0x04, 0x00, 0x06, 0x00, 0x00, 0x00, // 60ms per frame
      0x2c, 0x00, 0x00, 0x00, 0x00, side, 0x00, side, 0x00, 0x00,
      0x02,
      ...subBlocks,
    ];
  };

  return Buffer.from([...header, ...loop, ...frame(0), ...frame(1), ...frame(0), ...frame(1), 0x3b]);
}

const GIF = animatedGif();

const PAGE = `<!doctype html><html><body style="margin:0">
  <img id="spinner" src="/spinner.gif" width="64" height="64" style="image-rendering:pixelated">
</body></html>`;

let server: Server | undefined;
let browser: Browser | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    if ((request.url ?? '/').startsWith('/spinner.gif')) {
      response.writeHead(200, { 'content-type': 'image/gif' }).end(GIF);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
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
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

/**
 * Screenshot the image until it changes, or until the budget runs out.
 *
 * **Waiting, not sampling a fixed window**, and the difference was measured
 * rather than guessed. Headless Chromium advances an image animation when it
 * paints, not on a wall clock, so the delay before the first visible change is
 * not the frame delay: across eight trials it fell between 172ms and 497ms for
 * a GIF whose frames are 60ms apart. A six-sample, 420ms window therefore
 * failed about one run in six — claiming an animating image was still, which is
 * the exact false statement this suite exists to make impossible. **A flaky
 * test for a flake fix is a joke with a long setup.**
 *
 * So the reproduction arm stops as soon as it has its evidence and the frozen
 * arm spends the whole budget failing to find any. The two are asymmetric on
 * purpose: "it moved" is proven by one difference, and "it did not move" is only
 * as strong as how long you looked.
 *
 * `animations: 'allow'` is passed explicitly rather than left to the default,
 * because the default is Playwright's to change and this arm's whole job is to
 * let the page move.
 */
const BUDGET_MS = 3_000;
const GAP_MS = 50;

async function distinctRenderings(watch: boolean, stopOnChange: boolean): Promise<number> {
  const page: Page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

  try {
    const network = watch ? await observeNetwork(page) : undefined;
    await page.goto(`${base}/page`, { waitUntil: 'load' });
    await network?.settle();

    // Both arms compare screenshots, and a GIF that failed to decode paints
    // nothing in both — so "held still" and "never arrived" have the same
    // signature. This is the difference between them, checked before either arm
    // is allowed to conclude anything.
    const decoded = await page.locator('#spinner').evaluate((img) => ({
      width: (img as HTMLImageElement).naturalWidth,
      complete: (img as HTMLImageElement).complete,
    }));
    expect(decoded).toEqual({ width: 8, complete: true });

    const seen = new Set<string>();
    const until = Date.now() + BUDGET_MS;

    while (Date.now() < until) {
      const shot = await page.locator('#spinner').screenshot({ animations: 'allow' });
      seen.add(shot.toString('base64'));
      if (stopOnChange && seen.size > 1) break;
      await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    }

    await network?.close();
    return seen.size;
  } finally {
    await page.close();
  }
}

describe.skipIf(!BROWSER_AVAILABLE)('an animated GIF, which no CSS reaches', () => {
  it('keeps animating when nothing is watching the wire', async () => {
    // The reproduction, and the reason the next test is evidence rather than a
    // tautology. If this ever passes, the fixture has stopped animating and
    // everything below is asserting that a still image is still.
    expect(await distinctRenderings(false, true)).toBeGreaterThan(1);
  }, 60_000);

  it('holds still when the response is truncated to its first frame', async () => {
    // Three seconds of looking — six times the longest delay ever measured
    // before the unfrozen fixture moved.
    expect(await distinctRenderings(true, false)).toBe(1);
  }, 60_000);

  it('reports which URLs it froze, rather than freezing silently', async () => {
    const page = await browser!.newPage({ viewport: { width: 100, height: 100 } });

    try {
      const network = await observeNetwork(page);
      await page.goto(`${base}/page`, { waitUntil: 'load' });
      await network.settle();

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

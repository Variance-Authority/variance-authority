import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
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

/**
 * An opaque PNG, written here rather than imported from the thing under test.
 *
 * `blankPng` could produce these in one line and the blanking suite would then
 * be comparing its own output against itself — a substitution that changed
 * nothing would pass. So this writes its own: same one-bit palette, no `tRNS`,
 * palette entry 0 set to solid black, so every pixel paints.
 */
function solidPng(width: number, height: number): Buffer {
  const stride = Math.ceil(width / 8);
  const raw = Buffer.alloc(height * (stride + 1));

  const chunk = (type: string, data: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(1, 8);
  header.writeUInt8(3, 9);

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('PLTE', Buffer.from([0, 0, 0])),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

let server: Server | undefined;
let browser: Browser | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = request.url ?? '/';

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

    response
      .writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      .end(path.startsWith('/images') ? IMAGES_PAGE : PAGE);
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

import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SemanticNode } from '@variance-authority/core/format';
import { routeCollector, type Collected, type Collector, type Plan } from './index.js';

/**
 * The half of image removal the wire cannot decide.
 *
 * A request carries no idea which element wanted it. `role="presentation"` is a
 * fact about a document, so the trick that acts on it is a stylesheet —
 * `hide-presentational-images`, opt-in and in no default recipe. This suite is
 * the evidence for the three things that claim rests on: that it hides what the
 * page marked decorative, that it leaves the caret-sized icon beside it alone,
 * and that it does not move a single box while doing either.
 *
 * The last one is the whole reason it is `visibility` and not `display`. An
 * `<img>` with no CSS width lays out at its intrinsic size, so removing one from
 * the flow shifts everything after it — and a stabilizer that causes a layout
 * change reports it as a regression with a component's name attached.
 *
 * What this suite deliberately does *not* claim is that hiding an image stops
 * its bytes from invalidating anything. It does not, and the third case asserts
 * that it does not: the picture loses the image, the environment key keeps it.
 * Only blanking on the wire — `packages/playwright/src/network.chromium.test.ts`
 * — buys the key back, and reading these two files as alternatives is the
 * mistake this note exists to prevent.
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
    '\npackages/route-collector (presentational): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/**
 * An opaque PNG of a declared size, one solid colour.
 *
 * Opaque and coloured on purpose: a transparent placeholder would make "the
 * image is hidden" indistinguishable from "the image was never painted", which
 * is the confusion the whole page of assertions is trying to avoid.
 */
function solidPng(width: number, height: number, grey: number): Buffer {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let row = 0; row < height; row += 1) {
    raw.fill(grey, row * stride + 1, (row + 1) * stride);
  }

  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
    return Buffer.concat([head, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const HERO = { width: 120, height: 90 };
const CHEVRON = { width: 16, height: 16 };

/**
 * Neither image is given a CSS size, so both lay out at their intrinsic one and
 * a substitution that got the size wrong would show up as moved geometry.
 *
 * The chevron is the user-visible caret in a disclosure control: decorative to
 * look at, load-bearing to a reviewer, and exactly the thing an over-broad rule
 * would take out.
 */
const PAGE = `<!doctype html><html><body><main id="app">
  <section data-testid="panel">
    <img id="decor" role="presentation" src="/art/hero.png">
    <span id="tail"><img id="chevron" src="/icons/chevron.png" alt="expand"></span>
  </section>
</main></body></html>`;

/** The default recipe, plus the trick under test. Naming a recipe replaces it. */
const WITH_TRICK = [
  'pin-animations',
  'hide-scrollbars',
  'wait-for-fonts',
  'wait-for-images',
  'hide-presentational-images',
] as const;

const WITHOUT_TRICK = WITH_TRICK.slice(0, -1);

let server: Server | undefined;
let base = '';
/** Flipped between runs to re-serve a *different* hero under the same URL. */
let heroGrey = 0x40;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/art/hero.png') {
      response
        .writeHead(200, { 'content-type': 'image/png' })
        .end(solidPng(HERO.width, HERO.height, heroGrey));
      return;
    }
    if (path === '/icons/chevron.png') {
      response
        .writeHead(200, { 'content-type': 'image/png' })
        .end(solidPng(CHEVRON.width, CHEVRON.height, 0x20));
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
});

afterAll(async () => {
  if (server !== undefined) await new Promise<void>((resolve) => server!.close(() => resolve()));
});

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/decorated', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

async function collect(stabilize: readonly string[]): Promise<Collected> {
  const collector: Collector = await (
    await routeCollector({
      routes: { 'page/decorated': `${base}/page` },
      roots: ['#app'],
      stabilize,
    })
  )({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
    },
    plan: PLAN,
  });

  try {
    return await collector.collect(PLAN.subjects[0]!);
  } finally {
    await collector.close();
  }
}

/** Every `<img>` in the subject, in document order: `[hero, chevron]`. */
function imagesOf(reading: Collected): readonly SemanticNode[] {
  if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);
  if (reading.snapshot === undefined) throw new Error('no snapshot');

  const found: SemanticNode[] = [];
  const walk = (node: SemanticNode): void => {
    if (node.tag === 'img') found.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  walk(reading.snapshot.root);

  if (found.length !== 2) throw new Error(`expected two images, found ${found.length}`);
  return found;
}

describe.skipIf(!BROWSER_AVAILABLE)('an image the page marked decorative', () => {
  it('is hidden, and the icon beside it is not', async () => {
    const [hero, chevron] = imagesOf(await collect(WITH_TRICK));

    // The user-facing rule in one pair of assertions: "large illustration —
    // remove, `^` icon — keep". Nothing about the chevron is decorative to the
    // markup, and nothing about this trick may decide otherwise on its behalf.
    expect(hero?.style['visibility']).toBe('hidden');
    expect(chevron?.style['visibility']).not.toBe('hidden');
  }, 60_000);

  it('keeps the box it was holding open, to the pixel', async () => {
    const held = imagesOf(await collect(WITH_TRICK));
    const untouched = imagesOf(await collect(WITHOUT_TRICK));

    // `display: none` would pass the test above and fail this one, which is why
    // this one exists. The hero is 120×90 with no CSS size, so dropping it from
    // the flow pulls the chevron up and left by its whole height — a layout
    // change this tool caused, reported against a commit that did not.
    expect(held[0]?.rect).toEqual(untouched[0]?.rect);
    expect(held[1]?.rect).toEqual(untouched[1]?.rect);
    expect(held[0]?.rect?.width).toBe(HERO.width);
  }, 60_000);

  it('still moves the environment key when its bytes change, and should', async () => {
    heroGrey = 0x40;
    const before = await collect(WITH_TRICK);
    heroGrey = 0xc0;
    const after = await collect(WITH_TRICK);

    if (!before.ok || !after.ok) throw new Error('collection failed');

    // Not a defect — the limit of what a stylesheet can buy. The page still
    // fetched the image, so `assets` still records it, so a re-export still
    // costs a re-render before the run can find out the pixels are identical.
    // Blanking is the mechanism that answers this one, by writing
    // `blank:<rule>:<w>x<h>` where the byte digest would have gone; an operator
    // who wants the churn gone from the *key* has to name the URL or the size.
    const url = `${base}/art/hero.png`;
    expect(after.snapshot?.environment.inputs.assets[url]).not.toBe(
      before.snapshot?.environment.inputs.assets[url],
    );
  }, 60_000);
});

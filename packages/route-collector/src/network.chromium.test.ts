import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { documentDigest } from '@variance-authority/core';
import {
  routeCollector,
  type Collected,
  type Collector,
  type CollectorConfig,
  type Plan,
} from './index.js';

/**
 * What the wire knows that the page cannot.
 *
 * Two claims, and both are about the same missing field. `EnvironmentInputs`
 * has carried `assets` — "external assets keyed by request URL, valued by
 * content hash" — since the format existed, with its own docblock warning that
 * an uncovered input is a false `unchanged`. Nothing ever filled it. This suite
 * fills it from the only place the bytes exist, and then demonstrates the
 * failure that absence permitted.
 *
 * The page also serves an animated GIF, and this suite says almost nothing
 * about it: a GIF animating changes no attribute, no rule and no box, so a
 * semantic hash cannot see it move or see it stop. That claim needs a camera
 * and is asserted in `packages/playwright/src/network.chromium.test.ts`.
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
    '\npackages/route-collector (network): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/**
 * A four-frame GIF, 2×1, alternating black and white — built here rather than
 * committed as a fixture so every byte in the assertion has a reason above it.
 *
 * The LZW payloads *are* valid, unlike the unit tests' placeholders: a browser
 * decodes this one. With a two-colour table the minimum code size is 2, clear
 * code is 4, end code is 5, and a two-pixel row is `clear, px, px, end` packed
 * little-endian into three bytes.
 */
function animatedGif(): Buffer {
  const header = [
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // GIF89a
    0x02, 0x00, 0x01, 0x00, // 2 × 1
    0x80, 0x00, 0x00, // global colour table of 2, background 0, no aspect
    0x00, 0x00, 0x00, // index 0: black
    0xff, 0xff, 0xff, // index 1: white
  ];
  // Loop forever, so the browser genuinely animates rather than resting on the
  // last frame — which would make the freeze look like it worked when it had
  // simply run out.
  const loop = [
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30,
    0x03, 0x01, 0x00, 0x00, 0x00,
  ];

  const frame = (a: number, b: number): readonly number[] => {
    // clear(4) px(a) px(b) end(5), three bits each, LSB-first.
    const codes = [4, a, b, 5];
    let bits = 0;
    let width = 0;
    const bytes: number[] = [];
    for (const code of codes) {
      bits |= code << width;
      width += 3;
      while (width >= 8) {
        bytes.push(bits & 0xff);
        bits >>= 8;
        width -= 8;
      }
    }
    if (width > 0) bytes.push(bits & 0xff);

    return [
      0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, // 100ms, no disposal
      0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0x00, 0x00, // image descriptor
      0x02, // LZW minimum code size
      bytes.length, ...bytes, 0x00,
    ];
  };

  return Buffer.from([
    ...header,
    ...loop,
    ...frame(0, 1),
    ...frame(1, 0),
    ...frame(0, 0),
    ...frame(1, 1),
    0x3b,
  ]);
}

const GIF = animatedGif();

/** A 1×1 PNG. Two of them, differing only in the pixel. */
function png(red: number): Buffer {
  const raw = Buffer.from([0x00, red, 0x00, 0x00, 0xff]);
  const idat = deflateStored(raw);

  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
    return Buffer.concat([head, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** zlib with one stored (uncompressed) block — enough for five bytes. */
function deflateStored(data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt16LE(data.length, 0);
  length.writeUInt16LE(~data.length & 0xffff, 2);
  return Buffer.concat([
    Buffer.from([0x78, 0x01]), // zlib header
    Buffer.from([0x01]), // final stored block
    length,
    data,
    adler32(data),
  ]);
}

function adler32(data: Buffer): Buffer {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  const out = Buffer.alloc(4);
  out.writeUInt32BE(((b << 16) | a) >>> 0, 0);
  return out;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PAGE = `<!doctype html><html><body>
  <header><img id="chrome" src="/outside.png" width="10" height="10" alt=""></header>
  <main id="app">
  <section data-testid="panel">
    <img id="spinner" src="/spinner.gif" width="200" height="100" alt="">
    <img id="logo" src="/logo.png" width="40" height="40" alt="">
  </section>
</main></body></html>`;

let server: Server | undefined;
let base = '';
/** Flipped between runs to re-serve a *different* image under the same URL. */
let logoRed = 0x00;

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/spinner.gif') {
      response.writeHead(200, { 'content-type': 'image/gif' }).end(GIF);
      return;
    }
    if (path === '/logo.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(png(logoRed));
      return;
    }
    // Outside `#app`, so it is fetched by the page and referenced by no subject.
    if (path === '/outside.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(png(0x11));
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
  subjects: [{ subject: { id: 'page/assets', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

async function collect(
  options: { network?: boolean; hashAssets?: boolean } = {},
  blank?: CollectorConfig['blank'],
): Promise<Collected> {
  const collector: Collector = await (
    await routeCollector({
      routes: { 'page/assets': `${base}/page` },
      roots: ['#app'],
      ...options,
    })
  )({
    config: {
      viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
      ...(blank === undefined ? {} : { blank }),
    },
    plan: PLAN,
  });

  try {
    return await collector.collect(PLAN.subjects[0]!);
  } finally {
    await collector.close();
  }
}

function assetsOf(reading: Collected): Readonly<Record<string, string>> {
  if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);
  if (reading.snapshot === undefined) throw new Error('no snapshot');
  return reading.snapshot.environment.inputs.assets;
}

describe.skipIf(!BROWSER_AVAILABLE)('the bytes a page was served', () => {
  it('records a content hash for every asset, which nothing did before', async () => {
    const assets = assetsOf(await collect());

    expect(Object.keys(assets).sort()).toEqual([`${base}/logo.png`, `${base}/spinner.gif`]);
    for (const digest of Object.values(assets)) expect(digest).toMatch(/^v1:[0-9a-f]{32}$/);
  }, 60_000);

  it('moves the environment key when an image changes behind its URL', async () => {
    logoRed = 0x00;
    const before = await collect();
    logoRed = 0xff;
    const after = await collect();

    if (!before.ok || !after.ok) throw new Error('collection failed');

    // The false `unchanged` this field exists to prevent, demonstrated in the
    // direction that matters. Nothing in the DOM moved — same `src`, same box,
    // same rules — and the picture is a different picture. Without the asset
    // hash these two are one baseline and the run reports a pass.
    expect(assetsOf(after)[`${base}/logo.png`]).not.toBe(assetsOf(before)[`${base}/logo.png`]);
    expect(after.snapshot?.environment.semanticDigest).not.toBe(
      before.snapshot?.environment.semanticDigest,
    );
  }, 60_000);

  it('records only the assets the subject itself references', async () => {
    // The page fetches a header image that is outside `#app`. Folding it in
    // would make the key depend on what else the page happened to load — and on
    // a shared page, on which subjects ran first, which is order dependence in
    // the identity a baseline is stored under.
    const assets = assetsOf(await collect());

    expect(Object.keys(assets)).not.toContain(`${base}/outside.png`);
  }, 60_000);

  it('hands the same assets to the document, which is what decides to skip a render', async () => {
    // The half that was missing and had no symptom. `settle` compares this run's
    // document digest against the digest the baseline was painted from; a
    // document with no assets in it produces the same digest after a logo's
    // bytes moved, so the run skips the render and reports `unchanged` — the
    // exact false verdict hashing the bytes was added to close.
    logoRed = 0x00;
    const before = await collect();
    logoRed = 0xff;
    const after = await collect();

    if (!before.ok || !after.ok) throw new Error('collection failed');
    if (before.document === undefined || after.document === undefined) {
      throw new Error('no document');
    }

    expect(before.document.assets?.[`${base}/logo.png`]).toMatch(/^v1:[0-9a-f]{32}$/);
    expect(documentDigest(after.document)).not.toBe(documentDigest(before.document));
  }, 60_000);

  it('leaves the map empty, and visibly so, when the watch is off', async () => {
    // Not "absent". An empty asset map is a run that recorded nothing about its
    // assets, and it should be possible to tell that from a run that had none.
    expect(assetsOf(await collect({ network: false }))).toEqual({});
  }, 60_000);

  it('drops the digests for `hashAssets: false` and keeps everything else the wire does', async () => {
    // The distinction `docs/flakiness.md` sends a reader here for. A build whose
    // asset URLs already carry their own hash wants the redundant read gone and
    // has no reason to give up GIF freezing, blanking, or the retention a
    // portable document needs — and `network: false` is the setting that takes
    // all four together.
    const rule = { id: 'logo', url: '**/logo.png' } as const;
    const assets = assetsOf(await collect({ hashAssets: false }, [rule]));

    // The blanked URL is still in the map, because the blank *is* the value: a
    // rule that fired is an input, and recording it is how the environment key
    // says which run was blanked. Its neighbour, hashed on any other run, is
    // gone. Both facts come from the same routing being alive.
    expect(assets).toEqual({ [`${base}/logo.png`]: 'blank:logo:1x1' });
  }, 60_000);
});

/**
 * The GIF is on the page and hashed, and that is all this suite can say about
 * it. A GIF animating changes no attribute, no rule and no box — it changes
 * *pixels*, and the claim that freezing it holds an image still is asserted
 * against real screenshots in
 * `packages/playwright/src/network.chromium.test.ts`, where there is a camera.
 */

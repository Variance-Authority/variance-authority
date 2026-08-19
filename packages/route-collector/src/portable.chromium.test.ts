import { createServer, type Server } from 'node:http';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightRenderer } from '@variance-authority/playwright';
import type { RenderDocument } from '@variance-authority/core';
import { routeCollector, type Collected, type Plan } from './index.js';

/**
 * Can these pixels be made somewhere else?
 *
 * The route collector has always emitted a serializable document, and
 * `gates.md` has always called remote rendering *conditional* because of the
 * gap this suite closes: serializable says the value survives `JSON.stringify`,
 * portable says another machine can paint it. Between them sit the bytes of
 * every image, font and media response, which the document referred to by
 * digest and did not carry.
 *
 * The proof is deliberately rude about it. The last test shuts the origin
 * server down and *then* renders, because every weaker version of this
 * assertion passes while a cache, a keep-alive socket or a localhost route is
 * quietly still available. A document that paints with its own origin switched
 * off is the only one that has earned the word.
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
    '\npackages/route-collector (portable): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/** A 4×4 PNG of one solid colour, large enough to see in a raster. */
function png(red: number, green: number, blue: number): Buffer {
  const rows: number[] = [];
  for (let y = 0; y < 4; y += 1) {
    rows.push(0x00);
    for (let x = 0; x < 4; x += 1) rows.push(red, green, blue);
  }
  const idat = deflateStored(Buffer.from(rows));

  const chunk = (type: string, body: Buffer): Buffer => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), body])), 0);
    return Buffer.concat([head, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0);
  ihdr.writeUInt32BE(4, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function deflateStored(data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt16LE(data.length, 0);
  length.writeUInt16LE(~data.length & 0xffff, 2);
  return Buffer.concat([
    Buffer.from([0x78, 0x01]),
    Buffer.from([0x01]),
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

const LOGO = png(0xd0, 0x20, 0x40);

/**
 * Every reference is relative, which is the case that actually breaks.
 *
 * The wire records absolute URLs, because that is what a request is. The author
 * wrote `/logo.png`. If the document does not also carry the base those two
 * resolved against, the archive is keyed by addresses the rendered page never
 * asks for, and the render is a hole rather than an error.
 */
const PAGE = `<!doctype html><html><body><main id="app">
  <section data-testid="brand" style="padding:8px;background:#fff">
    <img id="logo" src="/logo.png" width="32" height="32" alt="">
  </section>
</main></body></html>`;

/** The same page, pointing at an asset the origin drops mid-request. */
const BROKEN = PAGE.replace('/logo.png', '/broken.png');

let server: Server | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/logo.png') {
      response.writeHead(200, { 'content-type': 'image/png' }).end(LOGO);
      return;
    }
    if (path === '/broken.png') {
      // Not a 404. A 404 is a response, and a response has a body the observer
      // can read and close over — the browser would paint the same broken box
      // in both runs, which is reproducible and therefore fine. The case that
      // has to refuse is the one where nothing readable arrived at all.
      request.socket.destroy();
      return;
    }
    const body = path === '/broken' ? BROKEN : PAGE;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
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
  if (server !== undefined) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

const PLAN: Plan = {
  subjects: [{ subject: { id: 'page/brand', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

async function collect(
  options: { portable?: boolean; network?: boolean } = {},
  path = '/page',
): Promise<Collected> {
  const collector = await (
    await routeCollector({
      routes: { 'page/brand': `${base}${path}` },
      roots: ['#app'],
      ...options,
    })
  )({
    config: {
      viewport: { width: 400, height: 300, deviceScaleFactor: 1, colorScheme: 'light' },
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

function documentOf(reading: Collected): RenderDocument {
  if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);
  if (reading.document === undefined) throw new Error('no document');
  return reading.document;
}

describe.skipIf(!BROWSER_AVAILABLE)('a document that can leave the machine', () => {
  it('carries no bytes by default, so nothing claims more than it did before', async () => {
    const document = documentOf(await collect());

    // The digest is still there. The absence being asserted is of *bytes*: an
    // adopter who never asked for portability keeps the document they had, at
    // the size they had, and `resources` stays undefined so no renderer reads
    // this as a closure claim and blocks the network on it.
    expect(document.resources).toBeUndefined();
    expect(Object.keys(document.assets ?? {})).toContain(`${base}/logo.png`);
  }, 60_000);

  it('closes over the bytes it was served, keyed by the URL the wire saw', async () => {
    const document = documentOf(await collect({ portable: true }));
    const url = `${base}/logo.png`;

    expect(document.resources).toBeDefined();
    expect(Object.keys(document.resources!)).toContain(url);

    const resource = document.resources![url]!;
    expect(Buffer.from(resource.bytes, 'base64').equals(LOGO)).toBe(true);
    expect(resource.contentType).toContain('image/png');

    // The half that makes the other half reachable: `/logo.png` in the markup
    // has to resolve to the key above, and only the base carries that.
    expect(document.baseUrl).toBe(`${base}/page`);
  }, 60_000);

  it('paints the same pixels from the archive as from the origin', async () => {
    const document = documentOf(await collect({ portable: true }));
    const renderer = await createPlaywrightRenderer({ waitForFonts: false });

    try {
      const archived = await renderer.render(document);

      // The same document with the closure removed: the renderer stops blocking
      // the network and fetches the image from the still-running server. Equal
      // bytes mean the archive is a faithful stand-in for the origin rather
      // than merely a document that renders without throwing.
      const { resources: _dropped, ...open } = document;
      const live = await renderer.render(open);

      expect(archived.bytes).toBe(live.bytes);
    } finally {
      await renderer.close();
    }
  }, 120_000);

  it('refuses at capture, naming the resource it could not close', async () => {
    const reading = await collect({ portable: true }, '/broken');

    // The whole point of failing here. The alternative is a document that
    // *says* it is closed while one URL is silently absent, which surfaces as a
    // hole painted on a machine that has no way to go and get the missing byte
    // — hours later, in someone else's report, with the origin out of reach.
    expect(reading.ok).toBe(false);
    expect(reading.ok === false && reading.because).toContain(`${base}/broken.png`);
  }, 60_000);

  it('will not pretend to close over a wire nobody is watching', async () => {
    // `network: false` is the option that stops the observer reading bodies, so
    // asking for portability alongside it is asking for bytes from a party that
    // was told not to look. Refused up front rather than at the far end of a
    // collection that was never going to produce them.
    await expect(collect({ portable: true, network: false })).rejects.toThrow(
      /portable documents need the network observer/,
    );
  }, 60_000);

  it('still paints after the origin is gone', async () => {
    const document = documentOf(await collect({ portable: true }));

    // The actual claim, and the only test here that could not pass by accident.
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;

    const renderer = await createPlaywrightRenderer({ waitForFonts: false });
    try {
      const raster = await renderer.render(document);
      expect(raster.width).toBeGreaterThan(0);
      expect(raster.height).toBeGreaterThan(0);

      // And the same document without its bytes paints something else: the
      // image request now fails, so the box is empty. Not an error — a browser
      // is happy to paint a hole — which is exactly why the assertion has to be
      // on the pixels. It is also what proves the render above read the archive
      // rather than a cache that happened to outlive the socket.
      const { resources: _dropped, ...open } = document;
      const broken = await renderer.render(open);
      expect(broken.bytes).not.toBe(raster.bytes);
    } finally {
      await renderer.close();
    }
  }, 120_000);
});

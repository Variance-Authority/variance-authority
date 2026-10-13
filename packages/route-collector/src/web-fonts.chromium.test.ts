import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import type { RenderDocument } from '@variance-authority/core/format';
import { routeCollector, type Collected, type Plan } from './index.js';

/**
 * A page set in a web font is painted in that font.
 *
 * The render document carries the rules that match the subject, and an
 * `@font-face` matches nothing: it names a file, not an element. Pruned with
 * everything else, it left the renderer a `font-family` naming a face nobody
 * declared, which every renderer answers with whatever it has installed — so
 * every image of a page that ships its own font was an image of the fallback,
 * and a change to the font moved no image at all.
 *
 * The face is declared in a linked sheet, with its file written against that
 * sheet, because that is what a bundler emits and the case that breaks: the
 * renderer's document has one inline sheet and a base, so a path left relative
 * to the sheet it came from resolves against the page and fetches nothing.
 *
 * And the server sends no CORS header, as neither a collector's server nor a
 * developer's does. The render is a document on `about:blank`, where the face is
 * a cross-origin font, and a browser refuses one of those without the header.
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
    '\npackages/route-collector (web fonts): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/** A real face, so the render can be told apart from the fallback by its pixels. */
const FACE = readFileSync(new URL('../../../site/public/fonts/inter.woff2', import.meta.url));

const PAGE = `<!doctype html><html><head>
  <link rel="stylesheet" href="/styles/site.css">
</head><body><main id="app">
  <section data-testid="card" id="card">Quartz glyph</section>
</main></body></html>`;

const SHEET = `@font-face {
  font-family: "Brand Sans";
  font-weight: 100 900;
  src: url("../fonts/brand.woff2") format("woff2");
}
@font-face {
  font-family: "Unused Face";
  src: url("../fonts/unused.woff2") format("woff2");
}
#card { background: #fff; font: 600 32px "Brand Sans", monospace; padding: 8px; }`;

let server: Server | undefined;
let base = '';

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path === '/styles/site.css') {
      response.writeHead(200, { 'content-type': 'text/css; charset=utf-8' }).end(SHEET);
      return;
    }
    if (path === '/fonts/brand.woff2') {
      response.writeHead(200, { 'content-type': 'font/woff2' }).end(FACE);
      return;
    }
    if (path === '/page') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
      return;
    }
    response.writeHead(404).end();
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
  subjects: [{ subject: { id: 'page/card', kind: 'route' } }],
  notObserved: [],
  warnings: [],
};

async function collect(options: { portable?: boolean } = {}): Promise<RenderDocument> {
  const collector = await (
    await routeCollector({ routes: { 'page/card': `${base}/page` }, roots: ['#app'], ...options })
  )({
    config: {
      viewport: { width: 400, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
    },
    plan: PLAN,
  });

  let reading: Collected;
  try {
    reading = await collector.collect(PLAN.subjects[0]!);
  } finally {
    await collector.close();
  }
  if (!reading.ok) throw new Error(`collection failed: ${reading.because}`);
  if (reading.document === undefined) throw new Error('no document');
  return reading.document;
}

/** The same document with every `@font-face` taken out: what the renderer used to get. */
function withoutFaces(document: RenderDocument): RenderDocument {
  return { ...document, css: document.css.map((sheet) => sheet.replace(/@font-face\s*\{[^}]*\}/g, '')) };
}

describe.skipIf(!BROWSER_AVAILABLE)('a subject set in a web font', () => {
  it('carries the face it is painted in, with its file written against the page', async () => {
    const css = (await collect()).css.join('\n');

    expect(css).toMatch(/@font-face\s*\{[^}]*"Brand Sans"[^}]*url\("\/fonts\/brand\.woff2"\)/);
    // Pruning still holds for faces: one nothing in the subject is set in is
    // not the subject's, and carrying it would key the subject on its file.
    expect(css).not.toContain('Unused Face');
  }, 60_000);

  it('keys the subject on the bytes of its face', async () => {
    // A font file replaced under the same name repaints every glyph and changes
    // no rule; only its digest in the asset key can say so.
    expect(Object.keys((await collect()).assets ?? {})).toContain('/fonts/brand.woff2');
  }, 60_000);

  it('paints the face rather than the fallback', async () => {
    const document = await collect();
    const renderer = await createPlaywrightRenderer();

    try {
      const painted = await renderer.render(document);
      const fallback = await renderer.render(withoutFaces(document));

      expect(painted.bytes).toBeDefined();
      expect(painted.bytes).not.toBe(fallback.bytes);
    } finally {
      await renderer.close();
    }
  }, 120_000);

  it('closes a portable document over the face, so it paints with the origin gone', async () => {
    const document = await collect({ portable: true });

    expect(Object.keys(document.resources ?? {})).toContain(`${base}/fonts/brand.woff2`);

    const renderer = await createPlaywrightRenderer();
    try {
      // A closed document answers only from what it holds. Painting other than
      // the fallback is the claim: the face's file was asked for, at the address
      // the document holds it under, and its bytes were there.
      const painted = await renderer.render(document);
      const fallback = await renderer.render(withoutFaces(document));
      expect(painted.bytes).not.toBe(fallback.bytes);
    } finally {
      await renderer.close();
    }
  }, 120_000);
});

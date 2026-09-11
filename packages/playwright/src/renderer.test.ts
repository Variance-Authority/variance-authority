import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';
import {
  digestBytes,
  documentDigest,
  identityDigest,
  type RenderDocument,
} from '@variance-authority/core/format';
import { comparePngs, decode } from '@variance-authority/png';
import { createPlaywrightRenderer } from './renderer.js';

/**
 * What the page pool has to be true for.
 *
 * `render` used to hold one page per viewport and reuse it. That is correct while
 * renders are sequential and catastrophic the moment they are not: `setContent`
 * replaces a page's entire document, so two concurrent renders sharing a page
 * paint each other's subject and each returns an image of the wrong one. Both
 * runs look successful. The verdicts are simply about the wrong components.
 *
 * So these tests are about *isolation under concurrency*, not about speed. A
 * timing assertion here would be flaky on a loaded machine and would not catch
 * the failure that matters.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const VIEWPORT = { width: 200, height: 120, deviceScaleFactor: 1, colorScheme: 'light' } as const;

function documentOf(id: string, colour: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id, kind: 'fixture' },
    html: `<div data-va-path="0" style="width:160px;height:80px;background:${colour}">${id}</div>`,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

describe.skipIf(!BROWSER_AVAILABLE)('createPlaywrightRenderer — concurrency', () => {
  it('partitions identity by the browser rasterization recipe', async () => {
    const pinned = await createPlaywrightRenderer();
    const changed = await createPlaywrightRenderer({ launchArgs: ['--disable-lcd-text'] });

    try {
      expect(pinned.identity.rasterization).toBeDefined();
      expect(identityDigest(pinned.identity)).not.toBe(identityDigest(changed.identity));
    } finally {
      await Promise.all([pinned.close(), changed.close()]);
    }
  });

  it('paints resource-closed documents without consulting the network', async () => {
    const renderer = await createPlaywrightRenderer({ waitForFonts: false });
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>',
    );
    const url = 'https://assets.example/components/icon.svg';
    const document: RenderDocument = {
      ...documentOf('fixture:resource', '#fff'),
      baseUrl: 'https://assets.example/components/',
      html: '<div data-va-path="0"><img src="icon.svg" width="20" height="20"></div>',
      assets: { [url]: digestBytes(svg) },
      resources: {
        [url]: {
          contentType: 'image/svg+xml',
          bytes: svg.toString('base64'),
          digest: digestBytes(svg),
        },
      },
    };

    try {
      await expect(renderer.render(document)).resolves.toMatchObject({
        documentDigest: documentDigest(document),
      });
      await expect(
        renderer.render({ ...document, resources: {} }),
      ).rejects.toThrow('has no bytes');
    } finally {
      await renderer.close();
    }
  });

  it('refuses queued HTTP and WebSocket egress from a resource-closed document', async () => {
    const renderer = await createPlaywrightRenderer({ waitForFonts: false });
    const closed = {
      ...documentOf('fixture:egress', '#fff'),
      resources: {},
      assets: {},
    } satisfies RenderDocument;

    try {
      await expect(
        renderer.render({
          ...closed,
          html:
            '<div data-va-path="0">HTTP</div>' +
            '<script>requestAnimationFrame(() => fetch("https://escape.example/late"))</script>',
        }),
      ).rejects.toThrow('https://escape.example/late');

      await expect(
        renderer.render({
          ...closed,
          html:
            '<div data-va-path="0">WebSocket</div>' +
            '<script>new WebSocket("wss://escape.example/socket")</script>',
        }),
      ).rejects.toThrow('websocket wss://escape.example/socket');

      await expect(
        renderer.render({
          ...closed,
          html:
            '<div data-va-path="0">Popup</div>' +
            '<script>window.open("https://escape.example/popup")</script>',
        }),
      ).rejects.toThrow('https://escape.example/popup');
    } finally {
      await renderer.close();
    }
  });

  it('does not apply resource-closed WebSocket policy to open documents', async () => {
    const renderer = await createPlaywrightRenderer({ waitForFonts: false });
    const document = {
      ...documentOf('fixture:open-websocket', '#fff'),
      html:
        '<div data-va-path="0">Open</div>' +
        '<script>new WebSocket("ws://127.0.0.1:1/socket")</script>',
    } satisfies RenderDocument;

    try {
      await expect(renderer.render(document)).resolves.toMatchObject({
        documentDigest: documentDigest(document),
      });
    } finally {
      await renderer.close();
    }
  });

  it('paints each document into its own page when several render at once', async () => {
    // The whole point. Six distinct colours rendered concurrently through a pool
    // of four: if any two shared a page, at least one image would carry another
    // subject's colour, and the digests would disagree with the sequential run.
    const renderer = await createPlaywrightRenderer({ concurrency: 4, waitForFonts: false });

    try {
      const colours = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff'];
      const documents = colours.map((colour, index) => documentOf(`fixture:${index}`, colour));

      const concurrent = await Promise.all(documents.map((document) => renderer.render(document)));

      // Rendered one at a time, which is what the old code did and is the
      // reference answer. Same renderer, so nothing else varies.
      for (const [index, document] of documents.entries()) {
        const alone = await renderer.render(document);
        const comparison = comparePngs(decode(concurrent[index]!.bytes), decode(alone.bytes));

        expect(
          comparison.changed['default'],
          `subject ${index} differs when rendered concurrently`,
        ).toBe(0);
      }
    } finally {
      await renderer.close();
    }
  }, 60_000);

  it('stamps every raster with its own document digest', async () => {
    // The cheaper half of the same guarantee, and the one that would survive a
    // pool bug that swapped two same-sized images: a raster carries the digest of
    // the document it was asked to paint, so a mix-up is visible without pixels.
    const renderer = await createPlaywrightRenderer({ concurrency: 3, waitForFonts: false });

    try {
      const documents = ['#111111', '#222222', '#333333', '#444444'].map((colour, index) =>
        documentOf(`fixture:${index}`, colour),
      );
      const rasters = await Promise.all(documents.map((document) => renderer.render(document)));

      expect(rasters.map((raster) => raster.documentDigest)).toEqual(
        documents.map((document) => documentDigest(document)),
      );
    } finally {
      await renderer.close();
    }
  }, 60_000);

  it('returns a page to the pool when a render throws, rather than deadlocking', async () => {
    // A pool of one, and the first render fails. Without a release on the failure
    // path the second call waits for a slot that is never coming, and the run
    // hangs with no error — the worst possible failure for a CI job.
    const renderer = await createPlaywrightRenderer({ concurrency: 1, waitForFonts: false });

    try {
      const broken: RenderDocument = {
        ...documentOf('fixture:broken', '#000'),
        // Zero-sized rather than absent, though both take Playwright's 30s
        // actionability timeout to fail — it waits for the element to become
        // shootable either way. That half minute is the price of this assertion
        // and it is worth paying: without a release on the failure path a pool
        // of one deadlocks, and a CI job that hangs with no error is a worse
        // outcome than any test being slow.
        html: '<div data-va-path="0" style="width:0;height:0"></div>',
      };

      await expect(renderer.render(broken)).rejects.toThrow();

      const raster = await renderer.render(documentOf('fixture:after', '#abcdef'));
      expect(raster.width).toBeGreaterThan(0);
    } finally {
      await renderer.close();
    }
  }, 60_000);
});

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\n@variance-authority/playwright (renderer pool): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

// @vitest-environment jsdom
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { documentDigest, type RenderDocument, type Viewport } from '@variance-authority/core';
import { acquireDocument } from '@variance-authority/dom';
import { comparePngs, decode } from '@variance-authority/png';
import { createPlaywrightRenderer } from '@variance-authority/playwright';
import type { Renderer } from '@variance-authority/raster';
import { connectRenderer, serveRenderer, type RenderServer } from '@variance-authority/remote';
import { mutationById } from './mutations.js';
import { renderStory } from './render.js';

/**
 * The offload, end to end: **jsdom describes, Chromium paints.**
 *
 * This is the claim the whole retention design rests on, and until now it was
 * only asserted. jsdom cannot rasterize anything — it has no layout engine, no
 * compositor, no fonts. What it can do is say precisely *what to paint*, and if
 * that description is faithful then the tier that decides almost everything does
 * not need a browser, and the tier that needs pinned pixels does not need to be
 * on the same machine.
 *
 * That is the direct answer to the cost that made containers the industry
 * default: rather than pin the whole pipeline everywhere in order to stabilise
 * the one artifact that is machine-bound, send the machine-bound artifact to the
 * one machine that is pinned. Measured on this corpus, a screenshot costs 65.4 ms
 * against 3.4 ms for a semantic collection (ADR-0010) — so the tier being
 * offloaded is also the tier that is rarely needed.
 *
 * What is asserted here is not "the image is right" — nothing in this repository
 * can define that without a second implementation to compare against. It is the
 * three properties that make the route *usable*: it paints something with the
 * subject's geometry, it responds to the styling the document carried, and it
 * produces the same image whether the renderer is in this process or on the
 * other side of a socket.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };
const STORY = 'page/todos--populated';

let renderer: Renderer | undefined;
let server: RenderServer | undefined;
let remote: Renderer | undefined;
let container: HTMLElement;

function acquire(mutationId?: string): RenderDocument {
  const mutation = mutationId === undefined ? undefined : mutationById(mutationId);
  renderStory(container, STORY, mutation ? { mutation } : {});

  return acquireDocument(container, {
    subject: { id: STORY, kind: 'story' },
    viewport: VIEWPORT,
    fonts: ['system-ui/400/normal/todomvc'],
  });
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;

  renderer = await createPlaywrightRenderer({ fonts: ['system-ui/400/normal/todomvc'] });
  server = await serveRenderer(renderer);
  remote = await connectRenderer({ endpoint: server.url });
}, 120_000);

afterAll(async () => {
  await server?.close();
  await renderer?.close();
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

// Announced at module scope, because that is the only place a reader of a
// skipped run sees anything. `it.skip` titles are invisible under the default
// reporter, which is the one CI uses.
if (!BROWSER_AVAILABLE) {
  console.warn(
    '\nexamples/todomvc (offload): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('rendering a document jsdom produced', () => {
  it('paints a subject with real geometry, from a host that has none', () => {
    // jsdom reports zeros from `getBoundingClientRect`, so the document carries
    // no layout at all. Everything in the image is the renderer resolving the
    // markup and CSS it was sent.
    return renderer!.render(acquire()).then((raster) => {
      expect(raster.width).toBeGreaterThan(100);
      expect(raster.height).toBeGreaterThan(100);
      expect(decode(raster.bytes).length).toBeGreaterThan(0);
    });
  });

  it('carries the tokens that pruning correctly removed', async () => {
    // `:root` is outside every subject, so the walk *down* from the subject drops
    // the rule that defines the design tokens. If nothing carried them,
    // `var(--va-color-accent)` would resolve to nothing and this image would be
    // the design system with its colours deleted.
    //
    // Two things carry them now, and the second arrived on 2026-08-06 when
    // `applicableCss` started collecting the frame's own rules: `:root` matches
    // `<html>`, which the frame reproduces and the renderer paints, so the real
    // rule ships. Stripping the inherited floor alone therefore changes nothing —
    // which is why this test asserts against *both* being gone rather than
    // against either, and why it would have passed vacuously if left as it was.
    const withTokens = await renderer!.render(acquire());

    const stripped = acquire();
    const blank = await renderer!.render({
      ...stripped,
      inherited: {},
      css: stripped.css.map((sheet) =>
        sheet
          .split('\n')
          .filter((rule) => !rule.includes('--va-color-accent'))
          .join('\n'),
      ),
    });

    const comparison = comparePngs(decode(withTokens.bytes), decode(blank.bytes));
    expect(comparison.changed['default']).toBeGreaterThan(0);
  });

  it('ships the token rule itself, rather than only its flattened values', () => {
    // The mechanism, pinned. A floor of computed values is a second, lossy copy
    // of a rule the frame could simply carry; now that `<html>` is reproduced,
    // the rule that defines the tokens is applicable and is shipped as authored.
    const document = acquire();

    expect(document.css.join('\n')).toContain('--va-color-accent');
  });

  it('repaints when the document changes and not otherwise', async () => {
    const before = await renderer!.render(acquire());
    const again = await renderer!.render(acquire());
    const accented = await renderer!.render(acquire('token-accent'));

    // Same document, same renderer, same run: byte-identical is the bar. A
    // renderer that cannot reproduce its own output makes every comparison
    // downstream of it a coin toss.
    expect(comparePngs(decode(before.bytes), decode(again.bytes)).changed['strict']).toBe(0);

    expect(
      comparePngs(decode(before.bytes), decode(accented.bytes)).changed['default'],
    ).toBeGreaterThan(0);
  });

  it('produces the same image over a socket as it does in process', async () => {
    // The property that makes offloading meaningful rather than merely possible.
    // If the hop changed the image, a pinned remote renderer would be a second
    // machine's worth of difference wearing the first machine's identity.
    const document_ = acquire();

    const local = await renderer!.render(document_);
    const over = await remote!.render(document_);

    expect(over.documentDigest).toBe(documentDigest(document_));
    expect(comparePngs(decode(local.bytes), decode(over.bytes)).changed['strict']).toBe(0);
  });

  it('reports the fonts the renderer did not have', async () => {
    // A substituted font changes every metric in the image and nothing else in
    // any artifact says so. An `unchanged` verdict over two substituted renders
    // is true and worthless, so the substitution is reported rather than absorbed.
    //
    // This assertion previously passed against `document.fonts.check`, which
    // does not answer this question — it reports webfont *loading*, and returns
    // true for a family invented on the spot because the browser will fall back
    // and paint something. The probe is metric-based now. See `probeFonts`.
    const raster = await renderer!.render({
      ...acquire(),
      fonts: ['DefinitelyNotInstalled/400/normal/zzz'],
    });

    expect(raster.missingFonts).toContain('DefinitelyNotInstalled');
  });
});

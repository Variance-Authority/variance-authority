import { describe, expect, it } from 'vitest';
import { documentDigest, type RenderDocument, type RenderResource } from './document.js';

const LOGO: RenderResource = { contentType: 'image/png', bytes: 'iVBORw0KGgo=', digest: 'v1:aaa' };
const FONT: RenderResource = { contentType: 'font/woff2', bytes: 'd09GMgAB', digest: 'v1:bbb' };

/** One build's document as a collector serving it on `origin` reads it. */
function servedAt(origin: string, resources: Readonly<Record<string, RenderResource>>): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'route:/home', kind: 'route' },
    html: '<main><img src="/logo.png"></main>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: ['img { width: 16px; }'],
    viewport: { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
    inherited: {},
    fonts: [],
    assets: { '/logo.png': 'v1:aaa' },
    baseUrl: `${origin}/home?tab=1`,
    resources,
    diagnostics: [],
  };
}

describe('documentDigest across the origin a build was served on', () => {
  it('digests one build served on two ports alike, so the render cache hits', () => {
    // A collector serves on a free port. The document keeps the absolute base,
    // because the renderer resolves against it, and the digest is of the build.
    const at = (origin: string): RenderDocument =>
      servedAt(origin, { [`${origin}/logo.png`]: LOGO, 'https://cdn.example/inter.woff2': FONT });

    expect(documentDigest(at('http://127.0.0.1:4001'))).toBe(documentDigest(at('http://127.0.0.1:4000')));
  });

  it('keeps a resource another origin serves apart from the same path on the page origin', () => {
    const page = 'http://127.0.0.1:4000';
    const own = servedAt(page, { [`${page}/logo.png`]: LOGO });
    const cdn = servedAt(page, { 'https://cdn.example/logo.png': LOGO });

    expect(documentDigest(cdn)).not.toBe(documentDigest(own));
  });

  it('moves when the base path moves, which is a different page', () => {
    const page = 'http://127.0.0.1:4000';
    const home = servedAt(page, {});

    expect(documentDigest({ ...home, baseUrl: `${page}/about` })).not.toBe(documentDigest(home));
  });
});

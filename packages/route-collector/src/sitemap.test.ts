import { describe, expect, it } from 'vitest';
import { locationsIn, routesFrom, routesFromFiles, subjectIdFor } from './sitemap.js';

/**
 * A subject list taken from what the application already publishes.
 *
 * The value is that a page added to the site is watched without a second commit.
 * The risk is the mirror of it — a page dropped from the sitemap stops being
 * watched, silently — so what is asserted here is that everything *ambiguous*
 * refuses rather than guesses, and that ids do not depend on which environment
 * the sitemap was served from.
 */

const SITEMAP = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://shop.example/</loc><lastmod>2026-08-01</lastmod></url>
  <url><loc>https://shop.example/cart</loc></url>
  <url><loc>https://shop.example/search?q=a&amp;b=2</loc></url>
</urlset>`;

describe('reading a sitemap', () => {
  it('takes the locations in document order and decodes their entities', () => {
    expect(locationsIn(SITEMAP)).toEqual([
      'https://shop.example/',
      'https://shop.example/cart',
      'https://shop.example/search?q=a&b=2',
    ]);
  });

  it('keys a subject by its path, so staging and production are one suite', () => {
    // Keying by the whole URL would make a staging run and a production run two
    // suites with two sets of baselines, over the same pages.
    expect(subjectIdFor('https://shop.example/cart')).toBe('cart');
    expect(subjectIdFor('https://staging.internal/cart')).toBe('cart');
    // A trailing slash collapses, and the site root gets a name rather than an
    // empty id nothing could `--subjects` or accept.
    expect(subjectIdFor('https://shop.example/cart/')).toBe('cart');
    expect(subjectIdFor('https://shop.example/')).toBe('/');
  });

  it('refuses two URLs whose paths collide rather than letting one win', () => {
    // One subject with two addresses: whichever came last would silently own it,
    // and the run would watch one page while reporting the other.
    const colliding = `<urlset>
      <url><loc>https://a.example/x</loc></url>
      <url><loc>https://b.example/x</loc></url>
    </urlset>`;

    expect(() => routesFrom(colliding)).toThrow(/two URLs whose paths are both/);
  });

  it('accepts the same URL listed twice, which is a duplicate rather than a conflict', () => {
    const repeated = `<urlset>
      <url><loc>https://a.example/x</loc></url>
      <url><loc>https://a.example/x</loc></url>
    </urlset>`;

    expect(routesFrom(repeated)).toEqual({ x: 'https://a.example/x' });
  });

  it('does not follow a sitemap index, because that is a crawler', () => {
    // A sitemap of sitemaps lists `<loc>` entries too. They are taken as pages,
    // and the run then reports them as pages that did not render — which is
    // visible, unlike a crawl that silently grew the suite.
    const index = `<sitemapindex>
      <sitemap><loc>https://a.example/pages.xml</loc></sitemap>
    </sitemapindex>`;

    expect(routesFrom(index)).toEqual({ 'pages.xml': 'https://a.example/pages.xml' });
  });
});

describe('reading a built directory', () => {
  it('names a page by what an operator types back, not by the file on disk', () => {
    // `cart/empty` is what `--subjects` and `variance accept` are given, so it
    // is what the id has to be. The URL keeps `.html`, because that is what the
    // server is asked for, and `index.html` already resolved to its directory —
    // an extension on the sibling beside it would be a difference nobody asked
    // for.
    expect(routesFromFiles(['index.html', 'about/index.html', 'cart/empty.html'], 'http://l:1/')) //
      .toEqual({
        '/': 'http://l:1/',
        about: 'http://l:1/about/',
        'cart/empty': 'http://l:1/cart/empty.html',
      });
  });

  it('refuses two files that would answer to one id rather than letting one win', () => {
    // `cart/empty.html` and `cart/empty/index.html` both name `cart/empty`.
    // Whichever sorted last would silently own the baseline.
    expect(() => routesFromFiles(['cart/empty.html', 'cart/empty/index.html'], 'http://l:1/')) //
      .toThrow(/two pages that are both the subject `cart\/empty`/);
  });
});

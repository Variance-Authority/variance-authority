import { JSDOM } from 'jsdom';
import { beforeEach, describe, expect, it } from 'vitest';
import { assetsFor, referencedAssets } from './assets.js';

/**
 * Which files a subtree asks for.
 *
 * Two failures matter here and they are opposite. Missing a URL puts a hole in
 * the environment key, and a hole in that key is a false `unchanged` — a logo
 * re-exported at the same address, compared equal. Including a URL the subject
 * does not reference makes the key depend on what else was on the page, which
 * for a shared-page run means the key depends on **run order**, and sharding a
 * suite would change every baseline's identity.
 *
 * jsdom computes styles from declared values rather than from a real cascade, so
 * the computed-style paths are asserted here on inline styles and against a real
 * engine in `route-collector/src/network.chromium.test.ts`.
 */

let dom: JSDOM;

function subtree(html: string): Element {
  dom = new JSDOM(`<!doctype html><html><body><main id="subject">${html}</main></body></html>`, {
    url: 'https://shop.example/story/index.html',
  });
  const root = dom.window.document.querySelector('#subject');
  if (root === null) throw new Error('no subject root');
  return root;
}

beforeEach(() => {
  dom?.window.close();
});

describe('the assets a subtree references', () => {
  it('resolves against the document rather than recording what was written', () => {
    // A key is compared across machines and checkouts. `../logo.png` means
    // different files from different pages, and two of them would collide.
    const root = subtree('<img src="../logo.png"><img src="/brand/mark.svg">');

    expect(referencedAssets(root)).toEqual([
      'https://shop.example/brand/mark.svg',
      'https://shop.example/logo.png',
    ]);
  });

  it('takes every srcset candidate, not the one this device would pick', () => {
    // Which candidate loads depends on the device pixel ratio. A key holding only
    // the chosen one lets the 2× asset change without moving a 1× runner's key —
    // same URL list, same key, different bytes on a retina reviewer's screen.
    const root = subtree('<img src="a.png" srcset="a.png 1x, a@2x.png 2x, a@3x.png 3x">');

    expect(referencedAssets(root)).toEqual([
      'https://shop.example/story/a.png',
      'https://shop.example/story/a@2x.png',
      'https://shop.example/story/a@3x.png',
    ]);
  });

  it('reads a background image, including one painted by a pseudo-element', () => {
    const root = subtree(
      '<div style="background-image: url(bg.png)"></div>' +
        '<style>#subject .icon::before { content: url("https://cdn.example/i.svg"); }</style>' +
        '<div class="icon"></div>',
    );

    const found = referencedAssets(root);
    expect(found).toContain('https://shop.example/story/bg.png');
    // The pseudo-element case is the one an attribute scan cannot reach at all,
    // and jsdom resolves it only when the rule is inline; the engine-level
    // assertion lives in the chromium test.
    expect(found.every((url) => url.startsWith('https://'))).toBe(true);
  });

  it('ignores a link destination, which is not an asset', () => {
    // Hashing every `href` would put the whole site in one subject's key, and
    // every navigation target's bytes would invalidate a component.
    const root = subtree('<a href="/checkout">Checkout</a><img src="x.png">');

    expect(referencedAssets(root)).toEqual(['https://shop.example/story/x.png']);
  });

  it('reads an SVG `use` and `image`, which name files through `href`', () => {
    const root = subtree(
      '<svg><use href="/sprite.svg#cart"></use><image href="/photo.jpg"></image></svg>',
    );

    expect(referencedAssets(root)).toEqual([
      'https://shop.example/photo.jpg',
      'https://shop.example/sprite.svg#cart',
    ]);
  });

  it('excludes the schemes that carry their own bytes or fetch nothing', () => {
    // A `data:` URL is already in the document, so hashing it would put the same
    // information in the key twice and make an inline SVG look like a fetch.
    const root = subtree(
      '<img src="data:image/gif;base64,R0lGOD"><img src="blob:https://shop.example/1"><img src="ok.png">',
    );

    expect(referencedAssets(root)).toEqual(['https://shop.example/story/ok.png']);
  });

  it('sees nothing outside the subject, which is what makes a shared page usable', () => {
    // The whole reason this function exists. Three hundred stories share one
    // document; a key built from the page's request history depends on which
    // stories ran first.
    const root = subtree('<img src="mine.png">');
    const outside = root.ownerDocument.createElement('img');
    outside.setAttribute('src', 'https://cdn.example/somebody-elses.png');
    root.ownerDocument.body.append(outside);

    expect(referencedAssets(root)).toEqual(['https://shop.example/story/mine.png']);
  });
});

describe('narrowing an observation to a subject', () => {
  it('keeps the digests of the URLs this subject references and no others', () => {
    const root = subtree('<img src="/logo.png">');

    expect(
      assetsFor(root, {
        'https://shop.example/logo.png': 'v1:aaa',
        'https://cdn.example/other.png': 'v1:bbb',
      }),
    ).toEqual({ 'https://shop.example/logo.png': 'v1:aaa' });
  });

  it('invents no entry for a URL nobody observed', () => {
    // An asset served from the browser's cache before the observation started
    // has bytes nobody here saw. A placeholder would be a claim about content,
    // and a wrong one that no later run could contradict.
    const root = subtree('<img src="/logo.png"><img src="/uncached.png">');

    expect(assetsFor(root, { 'https://shop.example/logo.png': 'v1:aaa' })).toEqual({
      'https://shop.example/logo.png': 'v1:aaa',
    });
  });
});

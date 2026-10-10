import { describe, expect, it } from 'vitest';
import { assetUrl, pageOrigin, withoutOrigin } from './origin.js';

describe('an asset key and the URL its bytes are kept under', () => {
  const base = 'http://127.0.0.1:4001/nested/page.html';

  it('resolves a path key against the document base, the inverse of keying it', () => {
    const url = 'http://127.0.0.1:4001/icon.svg';
    const key = withoutOrigin(url, pageOrigin(base));

    expect(key).toBe('/icon.svg');
    expect(assetUrl(key, base)).toBe(url);
  });

  it('keeps an absolute key another origin serves', () => {
    expect(assetUrl('https://cdn.example/icon.svg', base)).toBe('https://cdn.example/icon.svg');
  });

  it('answers the key unchanged with no base, or a base a path cannot resolve against', () => {
    expect(assetUrl('/icon.svg', undefined)).toBe('/icon.svg');
    expect(assetUrl('/icon.svg', 'about:blank')).toBe('/icon.svg');
  });
});

describe('pageOrigin', () => {
  it('answers the origin of an http or https page, port included', () => {
    expect(pageOrigin('http://127.0.0.1:4001/nested/page.html')).toBe('http://127.0.0.1:4001');
    expect(pageOrigin('https://example.test/')).toBe('https://example.test');
  });

  it('answers no origin for a page served by no http origin, or a base that does not parse', () => {
    expect(pageOrigin(undefined)).toBeUndefined();
    expect(pageOrigin('about:blank')).toBeUndefined();
    expect(pageOrigin('file:///tmp/page.html')).toBeUndefined();
    expect(pageOrigin('not a url')).toBeUndefined();
  });
});

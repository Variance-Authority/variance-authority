import { describe, expect, it } from 'vitest';
import { previewUrl } from './preview.js';

/**
 * Every base URL a project might hand this, including the wrong ones.
 *
 * Split from the suite that drives a preview because it shares nothing with it:
 * addressing a story is a pure function over a string, so this needs no fake
 * Storybook, no `document` and no jsdom, and runs in the default `node`
 * environment while its neighbours opt into a DOM.
 *
 * Imported from `./preview.js` rather than from `./preview-url.js` on purpose.
 * That is the path callers already import, so a re-export that stopped
 * re-exporting fails here rather than in somebody else's package.
 */

const BASE = 'http://localhost:6006';

describe('building a preview URL', () => {
  it('addresses a story on the preview iframe, in story view mode', () => {
    // `viewMode=docs` would render a page of prose around the component, and it
    // would be captured as the subject.
    expect(previewUrl(BASE, 'components-button--primary')).toBe(
      'http://localhost:6006/iframe.html?id=components-button--primary&viewMode=story',
    );
  });

  it('treats a base path as a directory rather than a file to replace', () => {
    // Without this, a Storybook served under a path resolves to the host root
    // and every story 404s identically.
    expect(previewUrl('http://example.test/design/storybook', 'a--b')).toBe(
      'http://example.test/design/storybook/iframe.html?id=a--b&viewMode=story',
    );
    expect(previewUrl('http://example.test/design/storybook/', 'a--b')).toBe(
      'http://example.test/design/storybook/iframe.html?id=a--b&viewMode=story',
    );
  });

  it('accepts a base that already names the preview itself', () => {
    // The likelier typo than a directory genuinely called `iframe.html`.
    expect(previewUrl('http://localhost:6006/iframe.html', 'a--b')).toBe(
      'http://localhost:6006/iframe.html?id=a--b&viewMode=story',
    );
  });

  it('works against a built Storybook on disk, with no server at all', () => {
    expect(previewUrl('file:///tmp/storybook-static', 'a--b')).toBe(
      'file:///tmp/storybook-static/iframe.html?id=a--b&viewMode=story',
    );
  });

  it('encodes a story id rather than pasting it into a query string', () => {
    // Story ids are derived from titles, and a title can contain anything.
    expect(previewUrl(BASE, 'a&b--c d')).toContain('id=a%26b--c+d');
  });

  it('refuses a link copied out of the manager instead of dropping half of it', () => {
    // `?path=/story/...` is the manager's URL, not the preview's. Joining onto
    // it would discard the query and quietly build a URL for a different story.
    expect(() => previewUrl(`${BASE}/?path=/story/components-button--primary`, 'a--b')).toThrow(
      /query or fragment/,
    );
  });

  it('refuses a host and port with no scheme, which URL parsing accepts as a protocol', () => {
    // `new URL('localhost:6006')` succeeds — protocol `localhost:`, path `6006`
    // — so the omitted scheme otherwise survives to a resolution failure whose
    // message is about `iframe.html` and says nothing about the real mistake.
    expect(() => previewUrl('localhost:6006', 'a--b')).toThrow(/protocol `localhost:`/);
  });

  it('refuses a base that is not a URL at all, and says what one looks like', () => {
    expect(() => previewUrl('./storybook-static', 'a--b')).toThrow(/absolute/);
  });

  it('refuses to build a URL for no story', () => {
    expect(() => previewUrl(BASE, '')).toThrow(/story id is required/);
  });
});

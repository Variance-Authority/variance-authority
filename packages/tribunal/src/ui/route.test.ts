import { describe, expect, it } from 'vitest';
import { PAGE_PATTERNS, hrefOf, isPagePath, parseRoute, type Route } from './route.js';

/**
 * The address, held to the two things that make it worth having.
 *
 * It has to survive the round trip — a route that renders an href the parser
 * reads back as something else is a link that goes somewhere other than where it
 * says. And it has to stay out of the API's way, because the same table decides
 * which paths get a document and a page pattern that swallowed `/review/builds`
 * would take the ingest down with the surface.
 */

const AWKWARD: readonly Route[] = [
  { page: 'builds' },
  { page: 'changelog' },
  { page: 'build', build: '7' },
  { page: 'build', build: '7', order: 'name' },
  { page: 'build', build: '7', order: 'size' },
  // The identifiers this surface actually carries. A subject is a route and a
  // width, so it has a slash in it; a build id from a CI system can carry one
  // too. Written raw these are extra path segments and the pattern stops
  // matching, which is a blank page rather than an error.
  { page: 'subject', build: 'main/17', subject: 'route/cart@1280' },
  { page: 'change', build: '7', change: 'Button' },
  { page: 'change', build: '7', change: 'ui/Button.Primary' },
  { page: 'run', build: '7' },
];

describe('a route and its address say the same thing', () => {
  it.each(AWKWARD)('reads back $page $build$subject$change', (route) => {
    expect(parseRoute(hrefOf(route))).toEqual(route);
  });

  it('drops the default arrangement from the address rather than writing it out', () => {
    // `?order=story` is the docket's own order. Writing it makes every link from
    // the build list carry a query nobody chose, and makes two addresses for one
    // page — which is two entries in the history for one back button.
    expect(hrefOf({ page: 'build', build: '7', order: 'story' })).toBe('/builds/7');
  });

  it('ignores an arrangement this build does not have', () => {
    // A link from a later version, or a hand-edited query. Falling back to the
    // docket's order is right; throwing would take the page down over a word.
    expect(parseRoute('/builds/7?order=vibes')).toEqual({ page: 'build', build: '7' });
  });

  it('serves the front page from the document a static host would name', () => {
    expect(parseRoute('/index.html')).toEqual({ page: 'builds' });
  });

  it('claims nothing it does not answer', () => {
    // Not a fallback to the build list. A path nobody owns is a rotted link, and
    // showing the front page tells a reviewer their link worked.
    expect(parseRoute('/builds')).toBeUndefined();
    expect(parseRoute('/builds/7/changes')).toBeUndefined();
    expect(parseRoute('/nothing/here')).toBeUndefined();
  });
});

describe('the pages and the API never contend for a path', () => {
  const API = [
    '/review/builds',
    '/review/builds/7',
    '/review/builds/7/subjects/story%3Acard/decision',
    '/review/builds/7/subjects/story%3Acard/after.png',
    '/review/changelog',
    '/review/sweep',
    '/baseline/find',
    '/baseline/describe',
    '/baseline/put',
    '/cache/find',
    '/cache/put',
    '/ui/review.js',
  ];

  it.each(API)('leaves %s to the router', (path) => {
    expect(isPagePath(path)).toBe(false);
  });

  it('claims every path a page is rendered at', () => {
    for (const route of AWKWARD) expect(isPagePath(new URL(hrefOf(route), 'http://x').pathname)).toBe(true);
  });

  it('names every page in the table exactly once', () => {
    const pages = PAGE_PATTERNS.map((each) => each.page);
    expect(new Set(pages).size).toBe(pages.length);
  });
});

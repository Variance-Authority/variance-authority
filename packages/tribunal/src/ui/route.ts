/**
 * Where you are, as an address — because this is a service and not a report.
 *
 * The surface began as a build report rendered into a page, and it kept the
 * report's idea of navigation: three `useState` values, one document, and a
 * scroll bar. That has three costs and they compound. A reviewer cannot send
 * anybody the thing they are looking at. A reload drops them back on the build
 * list. And, worst, nothing on the page can be *elsewhere* — every panel a build
 * knows about has to be on the build's own page, so the crossing against the
 * previous run ends up ten thousand pixels below the change it is about.
 *
 * An address fixes all three at once, and the third is the one that matters: once
 * a change has a URL, the panels that describe *that change* can live on it.
 *
 * ## One table, read from both ends
 *
 * {@link PAGE_PATTERNS} is the whole route set. The browser reads it to turn a
 * path into a {@link Route}; the Node service reads the same table to decide
 * which paths get the document. Two lists would drift, and the failure is silent
 * in the worst direction — a link the client can render and the server answers
 * with a 404.
 *
 * ## Disjoint from the API by construction
 *
 * The service answers `/review/…`, `/baseline/…`, `/cache/…` and `/history/…`.
 * Pages live at `/builds/…` and `/changelog…`, which share no first segment with
 * any of them. `serve.test.ts` holds that apart rather than trusting the reading:
 * a page pattern that swallowed an API route would take the surface down and the
 * ingest with it.
 *
 * ## Identifiers are encoded, because subjects have slashes in them
 *
 * A subject is `route/cart@1280`. Written raw it is two path segments and the
 * pattern stops matching, so every identifier goes through
 * `encodeURIComponent` on the way out and comes back through
 * `decodeURIComponent` — and `route.test.ts` asserts the round trip on the
 * awkward ones rather than on `Button`.
 */

/** How the docket is arranged. Part of the address, so an arrangement is shareable. */
export type Order = 'story' | 'name' | 'size' | 'places';

/** Which page, and what it is about. The client's entire navigation state. */
export type Route =
  | { readonly page: 'builds' }
  | { readonly page: 'build'; readonly build: string; readonly order?: Order }
  | { readonly page: 'change'; readonly build: string; readonly change: string }
  | { readonly page: 'subject'; readonly build: string; readonly subject: string }
  | { readonly page: 'run'; readonly build: string }
  | { readonly page: 'changelog' };

/** One row of the route table: a page, the paths it answers, and what they carry. */
export interface PagePattern {
  readonly page: Route['page'];
  readonly at: RegExp;
  /** The fields the captures fill, in order. */
  readonly parts: readonly ('build' | 'change' | 'subject')[];
}

/**
 * Every path this surface answers.
 *
 * Most specific first, though none of these can shadow another: a capture is
 * `[^/]+`, so `/builds/7/run` cannot be read as a build named `7/run`. The order
 * is for a reader, and for the day somebody adds a pattern that *can*.
 */
export const PAGE_PATTERNS: readonly PagePattern[] = [
  { page: 'builds', at: /^\/(?:index\.html)?$/, parts: [] },
  { page: 'changelog', at: /^\/changelog$/, parts: [] },
  { page: 'run', at: /^\/builds\/([^/]+)\/run$/, parts: ['build'] },
  { page: 'change', at: /^\/builds\/([^/]+)\/changes\/([^/]+)$/, parts: ['build', 'change'] },
  { page: 'subject', at: /^\/builds\/([^/]+)\/subjects\/([^/]+)$/, parts: ['build', 'subject'] },
  { page: 'build', at: /^\/builds\/([^/]+)$/, parts: ['build'] },
];

const ORDERS: readonly Order[] = ['story', 'name', 'size', 'places'];

/**
 * A path and its query as a route, or `undefined` when this surface owns neither.
 *
 * `undefined` rather than a fallback to the build list. A path nobody claims is a
 * link that has rotted or a deployment mounted somewhere this build does not know
 * about, and quietly showing the front page tells a reviewer their link worked.
 */
export function parseRoute(href: string): Route | undefined {
  const url = new URL(href, 'http://route.invalid');

  for (const pattern of PAGE_PATTERNS) {
    const found = pattern.at.exec(url.pathname);
    if (found === null) continue;

    const carried: Record<string, string> = {};
    pattern.parts.forEach((part, index) => {
      carried[part] = decodeURIComponent(found[index + 1] ?? '');
    });

    if (pattern.page !== 'build') return { page: pattern.page, ...carried } as Route;

    const asked = url.searchParams.get('order');
    const order = ORDERS.find((each) => each === asked);
    return {
      page: 'build',
      build: carried['build'] ?? '',
      ...(order === undefined ? {} : { order }),
    };
  }

  return undefined;
}

/** The address of a route, ready for an `href` or a `pushState`. */
export function hrefOf(route: Route): string {
  const at = (part: string): string => encodeURIComponent(part);

  switch (route.page) {
    case 'builds':
      return '/';
    case 'build':
      return route.order === undefined || route.order === 'story'
        ? `/builds/${at(route.build)}`
        : `/builds/${at(route.build)}?order=${route.order}`;
    case 'change':
      return `/builds/${at(route.build)}/changes/${at(route.change)}`;
    case 'subject':
      return `/builds/${at(route.build)}/subjects/${at(route.subject)}`;
    case 'run':
      return `/builds/${at(route.build)}/run`;
    case 'changelog':
      return '/changelog';
  }
}

/**
 * Whether a path is one of this surface's pages.
 *
 * The service's question, and it is deliberately not `parseRoute(path) !==
 * undefined`: a server that had to construct a route to decide whether to send a
 * document would be parsing query strings it will never read.
 */
export function isPagePath(path: string): boolean {
  return PAGE_PATTERNS.some((pattern) => pattern.at.test(path));
}

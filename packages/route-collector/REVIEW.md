# Reviewing `@variance-authority/route-collector`

The collector `variance run` loads for pages an application already serves: it
plans subjects from `routes`, a sitemap or a built directory, navigates each
one, waits for React to hydrate, and reads the subtree under `roots` through
`@variance-authority/playwright`. With `tests` it records what each page ran and
showed.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/route-collector/`.

## Contracts

- **The plan is the config's.** A planned id with no route, or a page none of
  whose `roots` match, is a collection failure, never dropped or captured empty;
  a route only the collector names is never planned. Written in [README › Put
  one route through review](README.md#put-one-route-through-review); pinned by
  [src/collector.chromium.test.ts](src/collector.chromium.test.ts) › "reports an
  id with no route rather than dropping it".
- **One id, one page.** A sitemap or directory id is its path; two URLs or two
  files answering to one id are refused, never resolved. Pinned by
  [src/sitemap.test.ts](src/sitemap.test.ts) › "refuses two files that would
  answer to one id rather than letting one win".
- **The sitemap's server is the one photographed.** Each entry is visited on the
  host the sitemap was read from, path and query kept; a sitemap index is not
  followed. Pinned by [src/sitemap.test.ts](src/sitemap.test.ts) › "visits the
  server the sitemap was read from, whatever host its entries name".
- **No component read before hydration.** The wait lasts while React has work or
  something is still arriving, and no clock ends it; a route React stopped
  hydrating with nothing arriving is refused at once; one React never loaded on
  waits only on scripts. Written in [README › Readiness and
  loading](README.md#readiness-and-loading); pinned by
  [src/hydration.chromium.test.ts](src/hydration.chromium.test.ts) › "waits for
  as long as the response the shell holds on takes", "refuses at once a route
  whose shell holds on something no response settles" and "reads a route React
  never loaded on once nothing is arriving".
- **An excluded page is named, not photographed.** `data-variance-exclude`
  anywhere lists the page as `excluded` with its reason and reads nothing.
  Pinned by
  [src/collector.chromium.test.ts](src/collector.chromium.test.ts) › "leaves out
  a page that marks itself excluded, naming its reason, and photographs
  nothing".
- **A width is navigated, not recorded.** `home@375` is its own subject, laid
  out by a navigation at that width, and keeps its route's `ready` marker.
  Pinned by [src/widths.chromium.test.ts](src/widths.chromium.test.ts) ›
  "re-navigates on a resize, so a media query decided at load is decided again".
- **Alone reads what the shared world reads.** Pinned by
  [src/alone.chromium.test.ts](src/alone.chromium.test.ts) › "reads the same
  document alone as it does in the shared world".

## Not this package's

- How the hydration and Suspense waits read React: `@variance-authority/react`.
- What a document carries, though these tests exercise it:
  `@variance-authority/dom`.

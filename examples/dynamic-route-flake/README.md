# Dynamic route flake

Two things change between two readings of the same card: one of them you wrote,
and the other cannot be blamed on any file. This example runs that case and
shows where the two answers part — the authored edit resolved to the component
and the line it was written at, the unstable half reported with no location at
all, because nothing in the document answers for it.

The page has a real `img` request to one stable URL. Its Playwright route returns
different SVG bytes on consecutive reads. A `PriceTag` style edit changes the
left side of the card; the dynamic image changes the right side despite the same
HTML, CSS, and image URL. The card is `src/product-card.tsx`, which renders
`src/price-tag.tsx` and `src/dynamic-image.tsx`; it is mounted into
`page/harness.html` by `src/page-agent.tsx`, which `test/page-agent-bundle.ts`
bundles for the browser. The run itself is `src/dynamic-route.chromium.test.ts`,
which installs the route that swaps the SVG fill between reads.

## Run it

You need a checkout, `yarn install`, `yarn build` (these tests import the
packages through their published entry points, so the built output has to
exist), and `npx playwright install chromium` — without a browser the file skips
itself rather than failing. From the repository root:

```bash
yarn vitest run examples/dynamic-route-flake/src/dynamic-route.chromium.test.ts
```

```
 RUN  v2.1.9 /…/variance-authority

 ✓ …/dynamic-route.chromium.test.ts > a dynamic Playwright image route > changes same-URL image bytes in an otherwise unchanged image element
 ✓ …/dynamic-route.chromium.test.ts > a dynamic Playwright image route > projects changed pixels through the existing region, DOM, Fiber, and source path
 ✓ …/dynamic-route.chromium.test.ts > a dynamic Playwright image route > keeps the source-backed PriceTag change reviewable in composition
 ✓ …/dynamic-route.chromium.test.ts > a dynamic Playwright image route > calls the repeated image-only difference sub-semantic instability, not a source change

 Test Files  1 passed (1)
      Tests  4 passed (4)
```

(`--reporter=verbose` prints the four names; the default reporter prints the
file line only.)

## What the four assertions show

A pixel difference outside the changed component is not automatically a
regression to ignore. The existing path clusters the image mask, joins its region
to the image's DOM box, reads its React Fiber owner, and resolves that owner to
source. It names `DynamicImage` as the location of the pixel change — at
`src/dynamic-image.tsx:1` — and `PriceTag`, at `src/price-tag.tsx:1`, as the
separate, source-backed review candidate: the one an author actually edited.

The third capture then reads the subject again with the original fill. The
document and the image element are byte-identical to the previous read and the
image pixels differ anyway. Structure, resolved style and geometry all agree, so
nothing in the box tree explains it; the difference lives below it, in
rasterization or compositing or an asset that answered differently. The run
reports that state as unstable with no location — `locateInstability` returns
`{ stable: false, band: 'sub-semantic', locations: [] }` and says, in full, that
the two captures "are identical in structure, resolved style and geometry, and
their images are not […] so no component is responsible and there is no source
location to fix. This belongs to the environment key, not to the code". No
production-code exception and no ignore declaration is involved: the volatility
lives in the Playwright route this example installs.

The route is deliberately volatile and the example controls both responses, so
it is a demonstration of the mechanism, not a claim about assets in general — a
CDN image that replaces itself can be a legitimate product change. Two readings
establish that a subject disagrees with itself; the document and source evidence
decide whether any component is responsible for it.

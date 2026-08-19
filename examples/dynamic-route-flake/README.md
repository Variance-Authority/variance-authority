# Dynamic route flake

**Showcase:** advanced Playwright asset flake and composition, not ordinary
visual regression.

The page has a real `img` request to one stable URL. Its Playwright route returns
different SVG bytes on consecutive reads. A `PriceTag` style edit changes the
left side of the card; the dynamic image changes the right side despite the same
HTML, CSS, and image URL.

**What it proves:** a pixel difference outside the changed component is not
automatically a regression to ignore. The existing path clusters the image mask,
joins its region to the image's DOM box, reads its React Fiber owner, and resolves
that owner to source. It names `DynamicImage` as the location of the pixel change
and `PriceTag` as the separate, source-backed review candidate.

The second read keeps the document and image element unchanged while the image
pixels differ again. That is **sub-semantic instability**: the evidence names
where the residue painted, but refuses to blame `DynamicImage` or any source file.
The dynamic route is a controlled flake in the Playwright harness, not a
production-code exception or an ignore declaration.

**Boundary:** the route is deliberately volatile and the example controls both
responses. It does not establish that every external asset is a flake; a CDN
image replacement can be a legitimate product change. Two readings establish
instability, while the document and source evidence decide whether any component
is responsible.

Run it with:

```bash
yarn workspace @variance-authority/example-dynamic-route-flake test
```

---
'@variance-authority/png': minor
'@variance-authority/store': minor
'@variance-authority/cli': minor
'@variance-authority/core': patch
'@variance-authority/playwright-test': patch
'@variance-authority/tribunal': patch
'@variance-authority/vitest-browser': patch
---

An accepted baseline is kept as a lossless WebP, in about half the bytes of the PNG it was captured as. A durable store's `put` encodes it once, on the accept, and decodes it back to check that every channel of every pixel survived, the colour under a transparent pixel included, before anything is written; a comparison only decodes, so a run that changes nothing encodes nothing. Captures and the render cache stay PNG; a report's before image is the baseline as it was kept, so `.before.webp` beside a WebP baseline, attached as `image/webp`. The sidecar records `"image": "webp"`; a baseline kept as a `.png` before has no such field, stays readable, and its next accept replaces it. A WebP holds at most 16,383 pixels on a side, so an accept refuses a larger image with the tree as it was. `createLfsStore` tracks `*-*.webp` by default and leaves an existing `*-*.png` entry in place; a `pattern` you set yourself must end in `.webp` or `*`, or the store refuses to open. `doctor --baselines` and the carried pathspecs count both extensions. `@variance-authority/png` adds `keepImage`, `decodePortable`, `imageFormat` and `KEEP_LIMIT`, its decoders read either format by the bytes' header, `imageSize` replaces `pngSize`, `diffImage` resolves to its PNG since either side may be a WebP and takes an optional decoder, `changeImages` takes decoded images rather than bytes, and `@variance-authority/png/header` reads a header without loading a codec. `@variance-authority/store` exports `KEPT`, `KeptAs` and `isKeptImage`, and a path template that ends in `.webp` is refused like one ending in `.png`. The tribunal worker labels each image by the format its bytes declare.

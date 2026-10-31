---
'@variance-authority/png': minor
'@variance-authority/store': minor
'@variance-authority/cli': minor
'@variance-authority/core': patch
'@variance-authority/tribunal': patch
'@variance-authority/vitest-browser': patch
---

An accepted baseline is kept as a lossless WebP, in about half the bytes of the PNG it was captured as. A durable store's `put` encodes it once, on the accept, and decodes it back to check that every channel of every pixel survived, the colour under a transparent pixel included, before anything is written; a comparison only decodes, so a run that changes nothing encodes nothing. Captures, the render cache and report images stay PNG. The sidecar records `"image": "webp"`; a baseline kept as a `.png` before has no such field, stays readable, and its next accept replaces it. A WebP holds at most 16,383 pixels on a side, so an accept refuses a larger image with the tree as it was. `createLfsStore` tracks `*-*.webp` by default and leaves an existing `*-*.png` entry in place; a `pattern` you set yourself must match `.webp`. `doctor --baselines` and the carried pathspecs count both extensions. `@variance-authority/png` adds `keepImage`, `imageFormat` and `KEEP_LIMIT`, its decoders read either format by the bytes' header, `imageSize` replaces `pngSize`, and `@variance-authority/png/header` reads a header without loading a codec. The tribunal worker labels each image by the format its bytes declare.

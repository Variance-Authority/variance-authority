# Reviewing `@variance-authority/unit-test`

`unit-test` writes what a jsdom unit test mounted — markup, the CSS that applies
and the bytes of every resource referenced — as a capture on disk that
`captureCollector` hands to `variance run` to paint in Chromium.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/unit-test/`.

## Contracts

- **A capture is resource-closed or it fails.** Every URL the subtree references
  arrives as bytes from `resolveResource` or as `{ absent: true }`; otherwise
  `capture` throws naming each URL. Written in
  [README](README.md#resources-arrive-as-bytes-or-the-capture-fails).
- **An asset is keyed by its path.** Pinned by
  [capture.test.ts](src/capture.test.ts) › "keys it by its path, so the port it
  was served on moves no key and no environment".
- **One subject id, one file.** A second write is refused naming the file, the
  first stays and no temporary file is left. Pinned by
  [capture.test.ts](src/capture.test.ts) › "refuses the second write and names
  the file both wanted".
- **No directory is not no captures.** Pinned by
  [archive.test.ts](src/archive.test.ts) › "refuses a directory that is not
  there instead of reporting no captures".
- **Without the React callbacks, no component names.** A capture without
  `provenanceOf` attaches no chain. Written in
  [README](README.md#every-option).
- **A value capture is canonical and refused where a document is read.** Keys
  sort, `undefined` drops, and a function, `Date`, `bigint` or non-finite number
  throws naming its pointer. Written in [README](README.md#snapshot-a-value).
- **A read archive is checked, not trusted.** Pinned by
  [value.test.ts](src/value.test.ts) › "refuses text that no longer matches its
  digest".
- **Removed styles come back in insertion order, once.** Pinned by
  [styles.test.ts](src/styles.test.ts) › "restores in insertion order, because
  that is cascade order".

## Not this package's

- Painting, comparing and the verdict: `@variance-authority/cli` and
  `@variance-authority/raster`.

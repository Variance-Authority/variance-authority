# Reviewing `@variance-authority/unit-test`

## Contracts

- **A capture is resource-closed or it fails.** Written in
  [README](README.md#resources-arrive-as-bytes-or-the-capture-fails).
- **An asset is keyed by its path.** Pinned by
  [capture.test.ts](src/capture.test.ts).
- **One subject id, one file.** Pinned by
  [capture.test.ts](src/capture.test.ts).
- **No directory is not no captures.** Pinned by
  [archive.test.ts](src/archive.test.ts).
- **Without the React callbacks, no component names.** Written in
  [README](README.md#every-option).
- **A value capture is canonical and refused where a document is read.** Written
  in [README](README.md#snapshot-a-value).
- **A read archive is checked, not trusted.** Pinned by
  [value.test.ts](src/value.test.ts).
- **Removed styles come back in insertion order, once.** Pinned by
  [styles.test.ts](src/styles.test.ts).

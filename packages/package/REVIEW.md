# Reviewing `@variance-authority/package`

`package` reads a TypeScript workspace's published API as data (`readSurface`)
and, through `./help`, the docs above its names and who imports them
(`readHelp`), from source and manifests, never a build.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/package/`.

## Contracts

- **Entrypoints open as Node opens them.** A string, an array or a
  conditions-only object opens `.`; a mixed object throws naming the manifest.
  Pinned by [manifest.test.ts](src/manifest.test.ts) › "reads a string
  `exports` as `.`", "takes the first entry of an array fallback that names
  something to open", "reads a condition-only object with no custom condition
  as `.`" and "refuses an object that mixes subpaths and conditions, naming the
  manifest".
- **Members are read as pnpm reads them.** A wildcard skips a dot directory, and
  a list that is not globs throws naming the file. Pinned by
  [members.test.ts](src/members.test.ts) › "leaves a directory whose name starts
  with a dot out of a wildcard, as pnpm does".
- **Built output is read as its source.** A target in `dist` maps back through
  `rootDir` and `outDir`. Written in
  [ADR-0080](../../docs/context/adr/0080-built-output-is-read-as-its-source.md).
- **A form it cannot name throws, never shrinks the surface.** Only `tolerant`
  records a stale subpath in `unreadable` instead. Written in
  [README](README.md#what-it-refuses).
- **A missing manifest is an answer.** Pinned by
  [manifest.test.ts](src/manifest.test.ts) › "publishes nothing when nothing at
  its root is a manifest, rather than refusing to be read".
- **Uncertain use is unknown, never unused.** Pinned by
  [write.test.ts](src/write.test.ts) › "counts it on the short page as unknown,
  not as unused".
- **Deep means past what the manifest promised.** Pinned by
  [entry.test.ts](src/entry.test.ts) › "names an entry the manifest declares and
  the reading could not follow to a file, and keeps a file past it deep".
- **One workspace, one answer.** Pinned by
  [surface.test.ts](src/surface.test.ts) › "reads the same workspace the same
  way twice".

## Not this package's

- Whether two readings differ: `@variance-authority/core`. Signatures:
  `readSurface` records the kind only
  ([README](README.md#what-it-records-and-what-it-does-not)).

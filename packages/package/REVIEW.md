# Reviewing `@variance-authority/package`

## Contracts

- **Entrypoints open as Node opens them.** Pinned by
  [manifest.test.ts](src/manifest.test.ts).
- **Members are read as pnpm reads them.** Pinned by
  [members.test.ts](src/members.test.ts).
- **Built output is read as its source.** Written in
  [ADR-0080](../../docs/context/adr/0080-built-output-is-read-as-its-source.md).
- **A form it cannot name throws, never shrinks the surface.** Written in
  [README](README.md#what-it-refuses).
- **A missing manifest is an answer.** Pinned by
  [manifest.test.ts](src/manifest.test.ts).
- **Uncertain use is unknown, never unused.** Pinned by
  [write.test.ts](src/write.test.ts).
- **Deep means past what the manifest promised.** Pinned by
  [entry.test.ts](src/entry.test.ts).
- **One workspace, one answer.** Pinned by
  [surface.test.ts](src/surface.test.ts).

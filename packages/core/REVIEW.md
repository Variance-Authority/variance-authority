# Reviewing `@variance-authority/core`

## Contracts

- **No DOM, no I/O, no runtime dependency.** Written in [README › What this is
  for](README.md#what-this-is-for) and [README › Hand an answer to another
  machine](README.md#hand-an-answer-to-another-machine).
- **Every name lives in one entrypoint, and `compare` returns no verdict.**
  Written in [README](README.md#entrypoints).
- **An empty band set is `null`, not the quietest band,** and a band the profile
  could not see is `UNOBSERVED`, which no verdict type admits. Written in
  [README](README.md#the-four-words-the-output-uses); pinned by
  [`src/compare/diff/diff.test.ts`](src/compare/diff/diff.test.ts).
- **`flake` is never returned on silence.** Written in
  [README](README.md#which-input-changed); pinned by
  [`src/compare/parting.test.ts`](src/compare/parting.test.ts).
- **Any part of the plan moves the identity, and two identities never compare.**
  Written in [README](README.md#what-it-refuses); pinned by
  [`src/plan/tool.test.ts`](src/plan/tool.test.ts).
- **A reach crosses type-only imports unless the caller asks a runtime
  question.** Pinned by
  [`src/relate/relate.test.ts`](src/relate/relate.test.ts).
- **A segment is validated before it is believed.** Pinned by
  [`src/segment/index.test.ts`](src/segment/index.test.ts).
- **A publish keeps what it must not overwrite.** Written in
  [README](README.md#hand-an-answer-to-another-machine); pinned by
  [`src/share/publish.test.ts`](src/share/publish.test.ts).
- **A line says why it missed.** Pinned by
  [`src/share/line.test.ts`](src/share/line.test.ts).

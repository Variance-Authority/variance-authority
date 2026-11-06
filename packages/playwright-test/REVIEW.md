# Reviewing `@variance-authority/playwright-test`

## Contracts

- **The host owns `test` and `expect`.** Written in
  [ADR-0043](../../docs/context/adr/0043-an-extension-does-not-own-its-host.md);
  pinned by [src/surface.test.ts](src/surface.test.ts).
- **Only an accepting run writes a baseline.** Written in [README › Establish
  the first baseline](README.md#establish-the-first-baseline); pinned by
  [src/accepted.test.ts](src/accepted.test.ts).
- **Pixels are not the only result.** Written in [README › Compared with
  `toHaveScreenshot()`](README.md#compared-with-tohavescreenshot); pinned by
  [src/direct.chromium.test.ts](src/direct.chromium.test.ts).
- **An unfinished spec never justifies a skip, and workers join.** Written in
  [README › Record what each spec
  executed](README.md#record-what-each-spec-executed); pinned by
  [src/execution.test.ts](src/execution.test.ts) and
  [src/reporter.test.ts](src/reporter.test.ts).
- **A shard holds whole files, or the run is refused before it starts.** Written
  in [README › Place a shard by whole
  files](README.md#place-a-shard-by-whole-files); pinned by
  [src/with-test-selection.test.ts](src/with-test-selection.test.ts).
- **A case is told apart by the project that ran it.** Pinned by
  [src/projects.chromium.test.ts](src/projects.chromium.test.ts).
- **Unlistened preconditions are unmeasured, not none.** Pinned by
  [src/arranged.test.ts](src/arranged.test.ts).

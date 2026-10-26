# Reviewing `@variance-authority/playwright-test`

`playwright-test` observes a state a Playwright test already reached, records
which spec reached which regions for selection, and reports to a watcher. A
`playwright.config` calls it; it calls `playwright`, `observe` and `vantage`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/playwright-test/`.

## Contracts

- **The host owns `test` and `expect`.** Neither is exported. Written in
  [ADR-0043](../../docs/context/adr/0043-an-extension-does-not-own-its-host.md),
  pinned by [src/surface.test.ts](src/surface.test.ts) › "does not export
  replacements for the runner-owned test and expect".
- **Only an accepting run writes a baseline.** A first run is `new` and writes
  nothing; only `--update-snapshots=all` or `=changed` promote, never the
  default `missing`. Written in [README › Establish the first
  baseline](README.md#establish-the-first-baseline), pinned by
  [src/accepted.test.ts](src/accepted.test.ts) › "adopts nothing in a run that
  does not accept".
- **Pixels are not the only result.** An ARIA change with identical pixels is
  `changed`, and in-place capture refuses screenshots that disagree. Written in
  [README › Compared with
  `toHaveScreenshot()`](README.md#compared-with-tohavescreenshot), pinned by
  [src/direct.chromium.test.ts](src/direct.chromium.test.ts) › "reports a
  browser ARIA change whose pixels remain identical" and "refuses an in-place
  image that changes between stability reads".
- **An unfinished spec never justifies a skip, and workers join.** A failed,
  timed-out or interrupted test leaves its file incomplete with its crossings
  kept; two workers' parts of one file are joined, never retired. Written in
  [README › Record what each spec
  executed](README.md#record-what-each-spec-executed), pinned by
  [src/execution.test.ts](src/execution.test.ts) › "retires a spec whose test
  failed, so it can never justify a skip" and
  [src/reporter.test.ts](src/reporter.test.ts) › "joins two workers that each
  ran part of one spec file".
- **A shard holds whole files, or the run is refused before it starts.** Below
  Playwright 1.62, or with a `--reporter` that drops the placing reporter, a
  sharded run exits at configuration time. Written in [README › Place a shard by
  whole files](README.md#place-a-shard-by-whole-files), pinned by
  [src/with-test-selection.test.ts](src/with-test-selection.test.ts) › "refuses
  a --shard the project's own Playwright would split test by test, before
  anything starts".
- **A case is told apart by the project that ran it.** Pinned by
  [src/projects.chromium.test.ts](src/projects.chromium.test.ts) › "tells the
  copies of a case apart by the project that ran each".
- **Unlistened preconditions are unmeasured, not none.** Pinned by
  [src/arranged.test.ts](src/arranged.test.ts) › "prints a run that did not
  record preconditions as unmeasured, not empty".

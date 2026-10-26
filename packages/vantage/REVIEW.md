# Reviewing `@variance-authority/vantage`

`vantage` holds a watched run: what every test of a suite in flight announced,
noted and stopped at, in a watcher's memory, over loopback HTTP.
`@variance-authority/playwright-test` reports to it through `openVantage`;
`@variance-authority/cli` and `@variance-authority/mcp` start and read it
through `attachVantage`. It imports no test runner.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/vantage/`.

## Contracts

- **Unwatched reports nothing.** With `VARIANCE_AUTHORITY_VANTAGE` unset,
  `openVantage()` is `undefined`; an address that is not `http:` on loopback is
  refused. Written in [README › Report from your own
  runner](README.md#report-from-your-own-runner), pinned by
  [src/watch.test.ts](src/watch.test.ts) › "reports nothing when nothing says
  anybody is watching" and "refuses an address that is not loopback".
- **A watcher cannot break the run.** The five reports are fire-and-forget, and
  a watcher gone before or during `waits` never fails a test. Pinned by
  [src/watch.test.ts](src/watch.test.ts) › "carries on when the watcher has gone
  away" and "carries on when the watcher goes away mid-wait".
- **A release is spent once.** `release` answers `false` for a test not stopped
  or already released, and no release outlives the stop it was meant for.
  Written in [README › Write your own
  watcher](README.md#write-your-own-watcher), pinned by
  [src/watch.test.ts](src/watch.test.ts) › "releases one test once, however many
  readers ask" and "forgets a test was waiting when it ends".
- **Dropped is counted, `pending` is exact, nothing is discarded unread.** Past
  a bound, entries drop from the front and are counted; `pending` stays exact
  after its announcements were dropped; a report for a test nothing opened is
  kept. Pinned by [src/observatory.test.ts](src/observatory.test.ts) › "keeps
  that tally exact after the announcements themselves were dropped", "counts the
  tests it dropped rather than answering as if they never ran" and "holds what
  arrives for a test nothing opened, rather than dropping the evidence".
- **The test is the address, not the body.** A report names its test by the path
  it arrives on, and a body of another `version` is dropped, never half-read.
  Written in the JSDoc of [src/report.ts](src/report.ts).
- **A snapshot is frozen.** `snapshot()` values do not change when the run does,
  and `previous` is the reading handed to the last reader. Pinned by
  [src/observatory.test.ts](src/observatory.test.ts) › "hands out a value that
  does not change when the run does" and
  [src/attach.test.ts](src/attach.test.ts) › "holds the previous reading, which
  is the state a live diff compares against".

## Not this package's

- How `ask run-signals` and the `variance_*` tools print a snapshot:
  `@variance-authority/cli` and `@variance-authority/mcp`. The `vae` coordinates
  and the page listener: `@variance-authority/event`.

# Reviewing `@variance-authority/vantage`

## Contracts

- **Unwatched reports nothing.** Written in [README › Report from your own
  runner](README.md#report-from-your-own-runner); pinned by
  [src/watch.test.ts](src/watch.test.ts).
- **A watcher cannot break the run.** Pinned by
  [src/watch.test.ts](src/watch.test.ts).
- **A release is spent once.** Written in [README › Write your own
  watcher](README.md#write-your-own-watcher); pinned by
  [src/watch.test.ts](src/watch.test.ts).
- **Dropped is counted, `pending` is exact, nothing is discarded unread.**
  Pinned by [src/observatory.test.ts](src/observatory.test.ts).
- **The test is the address, not the body.** Written in
  [src/report.ts](src/report.ts).
- **A snapshot is frozen.** Pinned by
  [src/observatory.test.ts](src/observatory.test.ts) and
  [src/attach.test.ts](src/attach.test.ts).

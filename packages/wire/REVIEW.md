# Reviewing `@variance-authority/wire`

## Contracts

- **The carrier wins over the address, and no channel is not an error.** Written
  in [README](README.md#how-a-process-under-test-finds-its-way-home); pinned by
  [`src/index.test.ts`](src/index.test.ts).
- **`channelTo` never routes through a carrier,** which would send the run's
  reports to the driver's own realm. Pinned by
  [`src/index.test.ts`](src/index.test.ts).
- **Only loopback `http` is ever sent to.** Written in
  [README](README.md#what-this-does-and-does-not-guard); pinned by
  [`src/index.test.ts`](src/index.test.ts).
- **`report` never throws; `deliver` never resolves on a loss.** Written in
  [README](README.md#report-and-deliver); pinned by
  [`src/index.test.ts`](src/index.test.ts).
- **Reports for one execution and instrument arrive in the order made.** Pinned
  by [`src/index.test.ts`](src/index.test.ts).
- **The execution comes from the path the listener minted, never the body.**
  Written in
  [README](README.md#the-drivers-end-from-variance-authoritywirelisten).
- **An unreadable body or an unhandled instrument is `404`,** never passed on
  half-read. Pinned by [`src/listen.test.ts`](src/listen.test.ts).
- **`GET` goes to `answer` only.** Pinned by
  [`src/listen.test.ts`](src/listen.test.ts).
- **The page's carrier holds what it cannot send yet, uncapped, in order.**
  Written in [README](README.md#the-pages-half).
- **The root entry imports no module.** Written in
  [README](README.md#requirements).

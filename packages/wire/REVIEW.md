# Reviewing `@variance-authority/wire`

The medium between a driver and the processes it runs: one execution id, one
loopback address per execution, a carrier for a realm the driver is inside, and
nothing written down. `event`, `sense/journey` and `vantage` report through it;
`playwright-test` and other drivers listen with `/listen`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/wire/`.

## Contracts

- **The carrier wins over the address, and no channel is not an error.**
  `channelFrom` tries `globalThis.__VAW__`, then the return cookie, then
  answers `undefined`. Written in the
  [README](README.md#how-a-process-under-test-finds-its-way-home) and pinned by
  [`src/index.test.ts`](src/index.test.ts) › "prefers a carrier in this realm to
  an address across a socket".
- **`channelTo` never routes through a carrier,** which would send the run's
  reports to the driver's own realm. Pinned by
  [`src/index.test.ts`](src/index.test.ts) › "is preferred over a sink this
  realm happens to have installed".
- **Only loopback `http` is ever sent to.** Written in the
  [README](README.md#what-this-does-and-does-not-guard) and pinned by
  [`src/index.test.ts`](src/index.test.ts) › "refuses an address that is not
  loopback, and one that is not http".
- **`report` never throws; `deliver` never resolves on a loss.** Written in the
  [README](README.md#report-and-deliver) and pinned by
  [`src/index.test.ts`](src/index.test.ts) › "what may be lost" and "what may
  not be lost".
- **Reports for one execution and instrument arrive in the order made.** Pinned
  by [`src/index.test.ts`](src/index.test.ts) › "keeps one execution’s reports
  in the order they were said".
- **The execution comes from the path the listener minted, never the body.**
  Written in the
  [README](README.md#the-drivers-end-from-variance-authoritywirelisten).
- **An unreadable body or an unhandled instrument is `404`,** never passed on
  half-read. Pinned by [`src/listen.test.ts`](src/listen.test.ts) › "refuses a
  body it cannot read rather than losing the run".
- **`GET` goes to `answer` only.** Pinned by
  [`src/listen.test.ts`](src/listen.test.ts) › "keeps reading separate from
  reporting, so an execution id cannot collide".
- **The page's carrier holds what it cannot send yet, uncapped, in order.**
  Written in the [README](README.md#the-pages-half).
- **The root entry imports no module.** Written in the
  [README](README.md#requirements).

## Where to look for a counterexample

- `src/index.ts`: a carrier installed while a non-loopback cookie is present,
  `localhost` against `127.0.0.1` for `home`, an `https:` loopback address, and
  a last `deliver` attempt that resolves on a non-`204`.
- `src/listen.ts` `wireCarrierSource`: an announcement before `__VAW_REPORT__`
  exists, then two after it.
- A body's shape belongs to the instrument that sends it; the medium imposes no
  schema.

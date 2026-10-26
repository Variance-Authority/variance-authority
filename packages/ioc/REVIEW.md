# Reviewing `@variance-authority/ioc`

The package lets an application module declare how to reset its own state, and
lets a test setup decide when that runs. Application modules call
`registerResetHandler`; a test setup calls `configureResetHandler` with the
runner's per-test hook. It imports no runner and no other package.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under `packages/ioc/`.

## Contracts

- **Without a driver, nothing is enrolled or run.** A shipped application never
  installs one, so a registration costs a comparison and keeps only a count and
  the first handler turned away. Written in the
  [README](README.md#declare-the-reset-where-the-state-lives) and pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts) › "registers nothing
  until a driver is installed".
- **A setup that runs late throws, unconditionally.** When a handler registered
  before `configureResetHandler`, the call throws with the count and the first
  handler's name and source. There is no opt-out. Written in the
  [README](README.md#install-the-driver-in-the-test-setup) and pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts) › "refuses a setup that
  runs after a module has already registered" and "names the first early handler
  and counts the rest".
- **The gate is the driver, never the build mode.** Nothing reads `NODE_ENV` or
  a bundler flag to decide whether handlers run. Written in the
  [README](README.md#why-the-gate-is-the-driver-and-not-the-build-mode).
- **The registry survives a module registry reset.** It lives on `globalThis`
  under a well-known symbol, so two copies of the module, `jest.resetModules()`
  or a fresh graph per file all see one driver. Written in the
  [README](README.md#why-the-gate-is-the-driver-and-not-the-build-mode) and
  pinned by [`src/reset/reset.test.ts`](src/reset/reset.test.ts) › "keeps the
  realm state where a module registry reset cannot reach it".
- **One throwing handler stops none of the others,** and the failures are
  reported together. Written in the [README](README.md#reference) and pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts) › "runs every handler
  even when one throws, and reports the failure".
- **A second driver is honoured, not guessed a duplicate.** Pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts) › "honours a second
  driver rather than guessing which one is a duplicate".
- **A handler registered after the driver is picked up; an unregistered one
  stops running.** Pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts) › "picks up a handler
  registered after the driver, as a late import would" and "stops running a
  handler that has been unregistered".

## Not this package's

- State in a dependency nobody can put a handler in: `variance run` observes
  it by reading a subject twice (README "What it does not cover").
- Module isolation between files: `@variance-authority/isolator`.

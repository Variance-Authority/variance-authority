# Reviewing `@variance-authority/ioc`

## Contracts

- **Without a driver, nothing is enrolled or run.** Written in
  [README](README.md#declare-the-reset-where-the-state-lives); pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts).
- **A setup that runs late throws, unconditionally.** Written in
  [README](README.md#install-the-driver-in-the-test-setup); pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts).
- **The gate is the driver, never the build mode.** Written in
  [README](README.md#why-the-gate-is-the-driver-and-not-the-build-mode).
- **The registry survives a module registry reset.** Written in
  [README](README.md#why-the-gate-is-the-driver-and-not-the-build-mode); pinned
  by [`src/reset/reset.test.ts`](src/reset/reset.test.ts).
- **One throwing handler stops none of the others,** and the failures are
  reported together. Written in [README](README.md#reference); pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts).
- **A second driver is honoured, not guessed a duplicate.** Pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts).
- **A handler registered after the driver is picked up; an unregistered one
  stops running.** Pinned by
  [`src/reset/reset.test.ts`](src/reset/reset.test.ts).

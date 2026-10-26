# Reviewing `@variance-authority/event`

## Contracts

- **An announcement marks when, never what.** Pinned by
  [`src/log.test.ts`](src/log.test.ts).
- **Nothing a listener does reaches the code that announced.** Written in
  [README](README.md#what-it-costs-where-nobody-is-listening); pinned by
  [`src/index.test.ts`](src/index.test.ts).
- **A breadcrumb returns the value it read and never throws.** Pinned by
  [`src/breadcrumb.test.ts`](src/breadcrumb.test.ts).
- **A wait reads the past as well as the future,** and a wait for an end stays
  open while only the start arrived. Written in
  [README](README.md#wait-for-it-in-a-test); pinned by
  [`src/log.test.ts`](src/log.test.ts).
- **A failed wait says what was heard; nothing heard is a setup fact.** Pinned
  by [`src/log.test.ts`](src/log.test.ts).
- **A closed log fails every wait and never hangs.** Pinned by
  [`src/log.test.ts`](src/log.test.ts).
- **A head's announcement answers to the execution that sent the request,**
  across an `await`, with two in flight; one no test owns is counted and named.
  Written in [README](README.md#how-an-announcement-gets-home); pinned by
  [`src/head.test.ts`](src/head.test.ts).
- **Without `VARIANCE_AUTHORITY_EVENTS` a head installs nothing.** Pinned by
  [`src/head.test.ts`](src/head.test.ts).
- **The page collector holds what came before the channel, in order, once.**
  Pinned by [`src/page.test.ts`](src/page.test.ts).

# Reviewing `@variance-authority/event`

Application source announces what the code decided with `vae`, `vaStart` and
`vaEnd`, and records what it read with `varianceBreadcrumb`; a test waits on an
announcement through an `EventLog`. `playwright-test` wires the log as the
`events` fixture; a head reports over `@variance-authority/wire`.

Adds to the [root REVIEW.md](../../REVIEW.md) for changes under
`packages/event/`.

## Contracts

- **An announcement marks when, never what.** Coordinates and a phase, no
  payload. Pinned by [`src/log.test.ts`](src/log.test.ts) › "records the
  coordinates and nothing a realm carried alongside them".
- **Nothing a listener does reaches the code that announced.** A missing,
  uncallable or throwing sink is silent; the story note and the sink are each
  tried whatever the other did. Written in the
  [README](README.md#what-it-costs-where-nobody-is-listening) and pinned by
  [`src/index.test.ts`](src/index.test.ts) › "survives a listener that throws".
- **A breadcrumb returns the value it read and never throws.** Pinned by
  [`src/breadcrumb.test.ts`](src/breadcrumb.test.ts) › "never throws, and still
  returns the value, when the recorder throws".
- **A wait reads the past as well as the future,** and a wait for an end stays
  open while only the start arrived. Written in the
  [README](README.md#wait-for-it-in-a-test) and pinned by
  [`src/log.test.ts`](src/log.test.ts) › "settles a wait against an
  announcement it already heard".
- **A failed wait says what was heard; nothing heard is a setup fact.** Pinned
  by [`src/log.test.ts`](src/log.test.ts) › "calls a run that heard nothing at
  all a setup problem".
- **A closed log fails every wait and never hangs.** Pinned by
  [`src/log.test.ts`](src/log.test.ts) › "fails a wait started after the run
  ended, rather than hanging".
- **A head's announcement answers to the execution that sent the request,**
  across an `await`, with two in flight; one no test owns is counted and named.
  Written in the [README](README.md#how-an-announcement-gets-home) and pinned by
  [`src/head.test.ts`](src/head.test.ts) › "keeps two concurrent executions
  apart".
- **Without `VARIANCE_AUTHORITY_EVENTS` a head installs nothing.** Pinned by
  [`src/head.test.ts`](src/head.test.ts) › "installs nothing when nothing says
  this process is under a run".
- **The page collector holds what came before the channel, in order, once.**
  Pinned by [`src/page.test.ts`](src/page.test.ts) › "holds what was announced
  before the channel existed, in order".

## Where to look for a counterexample

- `src/head.ts`: two requests whose handlers interleave across `await`, and a
  request with no cookie while another execution is open.
- `src/log.ts`: a wait subscribed after the announcement, a start heard twice
  and ended once, a timer left behind after a wait settles.
- `src/index.ts`: anything that makes the no-listener path throw or allocate.

## Not this package's

- Routing and delivery: `@variance-authority/wire`. Laying a breadcrumb on a
  case: `sense` ([spec 0102](../../docs/specs/0102-a-case-records-what-the-code-read.md)).

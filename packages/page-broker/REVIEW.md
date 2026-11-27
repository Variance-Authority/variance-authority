# Reviewing `@variance-authority/page-broker`

## Contracts

Written in [README](README.md) and pinned by
[src/surfaces.cases.ts](src/surfaces.cases.ts), the cases every surface
passes: over a document in [src/dom.test.ts](src/dom.test.ts) and over a
browser in [src/playwright.chromium.test.ts](src/playwright.chromium.test.ts),
each over a page that announces nothing.

- **One broker per complex part, any surface.** `broker.ts` decides outcomes from a `Surface`
  alone; `dom.ts` and `playwright.ts` only find, look and act. No runner is
  favoured, and of Variance Authority the package imports only
  `@variance-authority/core`.
- **The app announces nothing.** No `aria-busy`, no announced event, no
  attribute written for a test is read. An arrival is a declared broker's
  probe becoming visible.
- **Staying is never reported early.** It needs the act finished, nothing
  pending for the quiet period and the broker still visible, and a declared
  broker that appears first wins.
- **The order of a declaration decides nothing.** Two declared brokers visible
  at once fail; neither is picked.
- **An outcome on the page before the act is refused**, and the act does not
  run: its being there would read as the answer.
- **A failure names the action and what happened**: `expected X, reached Y`,
  the outcomes none of which was reached, or what kept the page busy.
- **An undeclared destination is never staying.** A navigation, a new page or a
  modal dialog that no outcome declares fails the action and is named.
- **Quiet is told by one clock on every surface.** `quiet-period.ts` keeps
  it; what counts as pending differs, since each surface sees different work:
  requests in flight over a browser, requests and document changes over a
  document. Over a browser, which requests count is `awaitedRequest`, from
  `@variance-authority/core`; over a document, it is the APIs the surface
  wraps, `fetch` and `XMLHttpRequest`. Whether a timer is the right way is
  [open](https://github.com/Variance-Authority/variance-authority/issues/1473).

## What it does not answer

When an action may start, what else is on the page, and whether a part that
left is gone. Each is a separate question, and none is answered by reading a
signal the app must be changed to give.

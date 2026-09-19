# Structural change

This example is the case a screenshot cannot hold at all: a change with zero
pixel difference.

The same `AccountCard` paints the same pixels in both variants. The second
variant changes the card from an unlabelled `div` to a labelled `section`, so a
screenshot has no difference to report while the captured document gains
structure and accessible semantics.

Run it and the two PNGs come back identical — same dimensions, zero changed
pixels — while the comparison returns one finding owned by `AccountCard`: the
root went from `div`, no role, no accessible name, to `section` with role
`region` named "Account". That is a component-owned finding, not a case for a
smaller pixel threshold; no threshold makes a difference of zero visible.

## The files

- [`src/AccountCard.js`](src/AccountCard.js) — the component. Both variants
  share every painted declaration.
- [`src/page-agent.js`](src/page-agent.js) — mounts the requested variant and
  captures it.
- [`page/harness.html`](page/harness.html) — the page the agent runs in.
- [`src/structural.chromium.test.ts`](src/structural.chromium.test.ts) —
  captures both variants, screenshots both, compares.
- [`test/page-agent-bundle.ts`](test/page-agent-bundle.ts) — bundles the agent
  for the page.

## Run it

You need a checkout, `yarn install`, `yarn build` (the example imports the
workspace packages from their built `dist`), and `npx playwright install
chromium`. Without a browser the test skips itself and says so.

From the repository root:

```bash
yarn vitest run examples/structural-change/src/structural.chromium.test.ts --reporter=verbose
```

```
 ✓ examples/structural-change/src/structural.chromium.test.ts > a structural change with no pixel delta > keeps the screenshot identical
 ✓ examples/structural-change/src/structural.chromium.test.ts > a structural change with no pixel delta > finds the changed document structure and accessible semantics
 ✓ examples/structural-change/src/structural.chromium.test.ts > a structural change with no pixel delta > attributes one structural finding to AccountCard

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

## Does a finding like this fail the build?

It is reported as a change, and a change holds the run open. A role or
accessible-name change lands in the `a11y` band — the loudest of the frequency
bands that decide how a kind of change is reported — and `variance run` exits
`1`, which the CLI reserves for *the run happened and found something a person
must decide about*. Exit `2` is reserved for *the run did not happen as
configured*, so a missing browser and a lost accessible name never arrive as the
same integer. A policy that names the band (`blocking: ['a11y']`) promotes it
from something a reviewer signs off to something that stops the merge on its own
terms.

Here, in the example, the comparison is asserted on directly, so a broken
expectation fails the Vitest run like any other test.

## Does it report every wrapper you swap for a fragment?

No, and by design. Before comparison, a `div` or `span` that exists only to hold
its children is collapsed out of the tree: no role, no accessible name, no ARIA
state, no allowlisted attribute, no text, no shadow content, and no style
declaration of its own beyond the initial values a bare element carries.
Removing one of those produces no delta, because nothing that renders or is
announced changed.

Anything else is kept, and removing it is reported. A wrapper carrying a
declared style, a name, a role, or an admitted attribute is evidence about the
wrapper; deleting evidence to keep a report quiet is the failure this rule is
written conservatively to avoid. So a fragment swap that drops a styled or named
element is reported — as a removed node, or as the role or name that went with
it — and you decide whether that was what you meant.

## Scope

One controlled Chromium fixture. It shows how a structural change is attributed;
it is not accessibility coverage and does not replace an accessibility audit.

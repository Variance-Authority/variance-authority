# @variance-authority/react

**Requires:** that `react-dom` rendered the tree you are pointing at. Not the
React package — there is no `import 'react'` anywhere in `src`, so it cannot pin,
duplicate or conflict with the application's own copy.

That distinction is the whole reason this is a package instead of a folder in
[`@variance-authority/dom`](../dom). The requirement is real and a consumer is
buying it; the npm dependency is not.

## What it produces

Given an element, the `Provenance` value `core` defines: the composite components
enclosing it, a props digest at each boundary, and the component that authored
it.

```ts
import { provenanceOf } from '@variance-authority/react';
import { collect } from '@variance-authority/dom';

const capture = collect(container, { subject, profile: 'jsdom', provenanceOf });
```

## Two constraints shape everything here

**1. Engine independence.** Traversal reads plain JavaScript objects React
attached to DOM nodes. Nothing touches layout, `getComputedStyle`, or any
Chromium-only API — which is why the same owner chains come out of jsdom and a
real browser, and why the cheap tier can carry the full provenance dimension in
milliseconds instead of paying for a browser to get it.

**2. No DevTools hook required.** The primary path is the `__reactFiber$…`
expando `react-dom` writes onto every host node it creates. The global hook is
consulted only for the exact React version, and only if it happens to exist.

## Why provenance is load-bearing, not decoration

It started as attribution — "which component produced this pixel". Since
[ADR-0007](../../docs/context/adr/0007-subject-boundary-is-the-component-tree.md)
it is also **correctness**: the component tree is what defines a subject's
boundary, so owner chains drive differ matching as well as reporting. A tree
matched without them matches by position, and a list that reordered looks like
every item changed.

## Honest limits

- **`_debugSource` is gone in React 19.** Per-element source locations were a
  React 18 affordance and are not coming back, so component→file resolution is
  done by reading the repository ([`core/attribute`](../core)'s `indexSource`)
  rather than by asking the fiber. See journal 0009.
- **A node React never rendered has no chain**, and says so — `NO_FIBER` with a
  reason, never an empty chain that reads like "no components involved".

## Reading

- [ADR-0005](../../docs/context/adr/0005-fiber-traversal.md) — why fibers, and why not the hook
- [ADR-0007](../../docs/context/adr/0007-subject-boundary-is-the-component-tree.md) — the subject boundary

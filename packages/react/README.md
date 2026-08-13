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

const capture = collect(container, { subject, viewport, engine: 'jsdom@30', provenanceOf });
```

## What else it reads off the same fiber

Provenance was the first question asked of it and is no longer the only one.
Each of these is a different question of the same object graph, and none of them
needs a hook, a build plugin or an annotation.

| | |
|---|---|
| `wiringOf` | hook shape, wrapper chain, context subscriptions, reconciliation keys — a **band**, folded in beside `style` by `collect` ([`framework.md`](../../docs/framework.md)) |
| `remountedSince` | which instances were destroyed and rebuilt rather than updated — a **finding**, because it is a property of a reading and not of a revision |
| `awaitSuspense` / `suspenseRefusal` | wait for every boundary under a node to settle, and rule on what to do if one did not ([ADR-0037](../../docs/context/adr/0037-a-subject-still-arriving-is-refused.md)) |
| `tapCommits` / `awaitQuiet` | which components are still committing, by name — the one export here with a precondition: it must be installed before `react-dom` loads, and refuses rather than reporting a page it reached too late |

The Suspense pair is what every shipped collector calls before it reads a page,
and it is split in two on purpose: the page waits and reports, the driver
decides. `awaitSuspense` returns `settled`, `pending` or `unobserved` — three
states, so a page with no React under it can never claim to have arrived — and
`suspenseRefusal` turns that into `string | undefined`, which is the shape a
caller cannot accidentally downgrade to a warning.

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

- **A source location needs a build setting on React 19.** The transform still
  computes every element's file, line and column; React 19 is what drops it —
  `jsxDEV` takes four parameters and overwrites the fifth, and `createElement`
  skips `__source` by name. `resolveProvenance` reads `_debugSource` when it is
  there (React ≤18) and otherwise reads what
  [`@variance-authority/jsx-source`](../jsx-source) recorded, which is one
  `jsxImportSource` setting away. With neither, attribution falls back to
  resolving a component *name* against a repository scan
  ([`core/attribute`](../core)'s `indexSource`) — the declaration rather than the
  call site.
- **A node React never rendered has no chain**, and says so — `NO_FIBER` with a
  reason, never an empty chain that reads like "no components involved".

## Reading

- [ADR-0005](../../docs/context/adr/0005-fiber-traversal.md) — why fibers, and why not the hook
- [ADR-0007](../../docs/context/adr/0007-subject-boundary-is-the-component-tree.md) — the subject boundary

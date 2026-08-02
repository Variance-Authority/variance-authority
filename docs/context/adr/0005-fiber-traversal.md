# ADR-0005 — Fiber traversal reads the DOM expando, not the DevTools hook

**Status:** accepted
**Date:** 2026-08-01

## Context

Spec §6.1 says the harness "walks the React fiber tree (DevTools global hook /
bippy-style traversal)". Those are two different sources with different
availability, and the difference decides whether provenance is a cheap-tier
dimension or a browser-tier one.

- The **DevTools global hook** (`__REACT_DEVTOOLS_GLOBAL_HOOK__`) exists only
  when the browser extension is installed, or when something installed it
  *before* React loaded. It is absent in a bare `vitest` process and in a fresh
  Playwright context, and installing it means injecting a script into the page
  before the app boots — a cooperation requirement on every consumer.
- The **DOM expando** (`__reactFiber$<random>`) is written by `react-dom` itself
  onto every host node it creates. It requires nothing, cooperates with nothing,
  and is present in jsdom and in a real browser identically.

ADR-0002 puts provenance in the cheap tier on the claim that "fiber traversal is
engine-independent". That claim holds only for a source that does not need a
browser extension.

Fiber internals are unversioned.

## Decision

**The expando is the primary and only required path.** The DevTools hook is
consulted for exactly one thing — the exact React version — and its absence
degrades a diagnostic field, never a chain.

Root enumeration, where it is needed, scans for `__reactContainer$<random>` on
elements rather than calling `hook.getFiberRoots()`.

The package imports React nowhere. Fiber shapes are declared structurally, so
`react` cannot pin, duplicate, or conflict with the application's
React copy, and a React major upgrade is a runtime concern rather than a
dependency-resolution one.

### Three internal contracts, and how each fails

Every assumption is commented in place. Three of them matter, each with the
symptom of its breaking:

1. **Expando key prefix.** `__reactFiber$` (React ≥17), `__reactInternalInstance$`
   (React 16); the suffix is `Math.random().toString(36).slice(2)` per `react-dom`
   instance, so it is discovered by scanning `Object.keys`, never hardcoded.
   *Breaks as:* every node reports the `no-client-fiber` sentinel. Loud.
2. **Work-tag numbers.** `ReactWorkTags.js` assigns them by declaration order.
   The traversal treats an unrecognised tag as "not an owner frame" and keeps
   walking. *Breaks as:* chains lose frames. Quiet, but recoverable — and
   preferable to a collector that throws mid-capture.
3. **Double buffering.** The expando is written once at mount and never
   re-pointed, so on alternating commits it addresses the stale half of the pair.
   Resolution walks to the tree top and asks the `FiberRoot` which half is
   `current`. *Breaks as:* props digests one render stale — the most dangerous
   of the three, because a stale digest still looks like a valid digest.

### Two chains, kept separate

`owners` (the `return` chain, filtered to composites) and `createdBy`
(`_debugOwner`) are not redundant. `owners` answers *where a node ended up*;
`createdBy` answers *who authored it*. They diverge whenever an element is passed
as a prop, and §6.2 needs both: attribution wants the author, root/collateral
analysis wants the enclosure.

`createdBy` is development-only — React does not populate `_debugOwner` in
production builds — and is omitted rather than faked when absent.

## Consequences

- `children` is excluded from every props digest. Including it would make any
  descendant change move every ancestor's incoming digest, and §6.2's "subtree
  changed while incoming props held ⇒ this component is the root" could then
  never be satisfied by anything below the application shell.
- `memo()` wrapper fibers (work tag 14) do not produce frames. React emits a
  wrapper *plus* an inner fiber for `memo(fn, compare)` and `memo(forwardRef(f))`
  but a single collapsed fiber for `memo(fn)`; counting the wrapper would make
  `owners[0]` depend on whether the author passed a comparator.
- Component names come from `elementType` before `type`, because a
  `SimpleMemoComponent` fiber keeps the `memo()` object — and any `displayName`
  set on it — only in `elementType`.
- A node with no fiber returns a documented sentinel, not an empty `Provenance`.
  An empty owner chain is a claim ("owned by nobody") and would be
  indistinguishable from a node rendered directly by a root.

## What this forecloses

- Any dependency on the DevTools extension, or on injecting a hook before app
  boot. Consumers do not have to cooperate.
- Reading owner chains out of a production bundle with full fidelity: `createdBy`
  and source location are dev-only, and no amount of traversal recovers them.
- Synthesizing owner frames for React Server Components. A server component never
  becomes a client fiber, so it has no props on the client; emitting a frame with
  an empty props digest would assert "these props did not change" about props
  that were never observed — the false-`unchanged` failure ADR-0002 forbids. RSC
  attribution needs build-time annotation, not traversal.

## Known limits

`core.digestString` imports `node:crypto`. `propsDigest` must run *in the page*
— a prop can be a function or an element, and neither survives serialization out
of a browser — so `core`'s only hash implementation cannot run where it is
needed. This contradicts nothing in ADR-0001's wording but breaks its intent that
`core` be environment-free. It is owned by `core`, not by this package; recorded
in `journal/0002`.

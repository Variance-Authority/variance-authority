# ADR-0018 — A component's hash covers its own nodes, and only structure crosses tiers

**Status:** accepted
**Date:** 2026-08-03
**Extends:** ADR-0002 (observation profiles), ADR-0007 (the subject boundary is the component tree), ADR-0008 (per-profile expectations)
**Discharges:** the per-component band hashing spec

## Context

A snapshot carries a `structureHash` and a `styleHash` for the whole subject.
That answers "did anything change" and nothing else: it cannot say which
component, and it moves whenever anything inside it moves. Any question about
*an area over time* — when did this last change, how often does it churn — needs
a hash per component, and the shape of that hash decides whether the answers mean
anything.

Two ways to get it wrong are both natural. Hash a component's whole subtree, and
every ancestor moves on every leaf edit: the page root is reported as changed on
every commit and the record carries no information. Blend the bands into one
digest, and the same page hashes differently depending on which tier ran, so the
record churns on CI configuration rather than on code.

## Decision

**A node belongs to the nearest enclosing component boundary, and a component's
hashes cover only the nodes whose nearest boundary is that component.**

Where a nested component sits in the parent's node order, the parent's
`structure` hash carries a **placeholder naming that component**. So adding,
removing or reordering a child component is the parent's own change and moves the
parent; what the child renders internally does not. Composition is the parent's
business and content is the child's, and the hash draws the line there.

**Bands are hashed separately and never blended.**

| Band | Covers |
|---|---|
| `structure` | tag, role, accessible name, state, normalized attributes, text, child order, nested-boundary placeholders |
| `style` | resolved declarations and the token names they resolved through |
| `geometry` | rects |

**`geometry` is omitted, not empty, under a profile that cannot observe layout.**
An empty digest would compare equal between a run that saw no movement and a run
that could not see movement, which is the false `unchanged` this project exists
to refuse (ADR-0002).

**Only `structure` crosses tiers.** Measured on this repository's corpus:
**structure agrees on 107 of 107 component boundaries across `jsdom` and
`chromium`; style agrees on 0 of 107.** That is not a defect — `jsdom` resolves
declared style and `chromium` resolves computed style, which are two different
observations of one page, and comparing them is exactly what the profile-scoped
environment key exists to prevent. The consequence belongs to whatever keeps a
record: a row carrying `style` or `geometry` **must** record which profile
produced it, and a query that crossed profiles on either would report a change
caused by the tier that ran rather than by an edit.

**Paths are not hashed.** A node path is an address and shifts when unrelated
siblings move. Only content is hashed.

**Instances fold in document order.** A component with N instances contributes
one entry whose hashes cover the ordered list of instance hashes, so reordering
instances is a change. Per-instance identity is deliberately absent: instance
keys shift exactly when content moves, which is precisely when they would be
consulted. A run report answers *which instance*; a record over time answers
*which area*.

## Consequences

**The acceptance is scored against the corpus, not against fixtures.**
`examples/kitchen-sink/src/measure.chromium.test.tsx` asserts that no component
hash moves on any case the corpus declares stable, and that at least one moves on
every case it declares changed. The second direction is the one that would make a
record useless rather than merely noisy: a change nothing recorded is a change
nobody can ever ask about again.

**Raster hashes are excluded and always will be.** Pixel content is machine-bound
and cannot enter a record that crosses machines — the same measurement that
retired the pixel-count ledger (a 1px token edit producing 4949 changed pixels,
because the count is dominated by how much page sits below the edit).

**Nothing calls this from a run.** `hashComponents` ships, is unit-tested and is
corpus-scored, and the only callers are its own tests. The consumer path is the
open half of the history branch and is tracked in the checkpoint, not here — this
ADR records what a hash means, which is settled whether or not anything asks.

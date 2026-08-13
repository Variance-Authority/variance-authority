# Spec 0024 — what a prop controls

**Missing:** the name of the prop. `OwnerFrame` carries one digest over the whole
props object, so a run can say *this component was handed something different*
and never *which thing*.
**Built on:** [ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md),
the band split it produced, and
[`contrast.test.tsx`](../../examples/todomvc/src/contrast.test.tsx) — which
measures the answer for seven props and proves the inference is sound before any
of it is wired.

## Purpose

[`composition.md`](../composition.md) ends its ladder at `unexplained`: no edited
file, no moved token, no edited caller, no contradiction. The question it cannot
ask is the next one a person asks, which is *could anything this component was
passed have done this?*

Answering it needs no new collection. A `ComponentInstance` already carries five
band digests and a props digest, and two instances of one component — one from
the baseline, one from the candidate — are already a controlled experiment with
everything except the change held still. What stops the fold is that the props
side of it is a single opaque value: two instances can be seen to disagree about
their inputs, and nothing recovers which input.

The spike measures what the answer looks like once that is fixed. Seven props of
one small design system reach five distinct sets of bands:

| Prop | Moves |
|---|---|
| `Chip.selected` | `semantics`, `style` |
| `Chip.label` | `semantics`, `text` |
| `Text.tone` | `style` |
| `Text.size` | `style` |
| `Text.as` | `structure`, `semantics` |
| `Button.variant` | `style` |
| `Toggle.checked` | `structure`, `semantics`, `style` |

Three of those rows are wider than the obvious guess, and each for a reason the
system already holds: a `<button>` takes its accessible name from its content, so
`label` reaches `semantics`; `ATTRIBUTE_ALLOWLIST` drops `aria-*` and keeps
`checked`, so `selected` and `checked` land in different numbers of bands for
what looks like the same kind of prop. **That is the argument for measuring this
per component rather than writing it down once** — the table is a property of a
design system's implementation, not of its API.

## What would discharge it

**A per-key digest beside the whole-object one.** `OwnerFrame` gains a map from
prop name to digest, computed by the same `shapeOf` projection `propsDigest`
already uses and excluding `children` for the same reason it already does.

This is cheaper than it sounds, and the reason is worth recording:
[`boundary.ts`](../../packages/core/src/attribute/boundary.ts) pushes only
`frame.propsDigest` into the value it hashes. **An added field on `OwnerFrame`
does not reach any stored digest, so it invalidates no baseline.** The change is
additive at the format level, which is why it can ship without a migration.

The shape, and the decisions it forces:

- **Where the map lives.** `OwnerFrame` repeats at every node in a boundary, so a
  naive per-frame map multiplies the wire by the node count. Emitting it once per
  boundary is smaller and needs a join the format does not currently have. This
  is the decision worth arguing about, because it is the one that is hard to
  reverse.
- **What a differential is folded over.** Two runs of one subject (baseline
  against candidate) is one source of contrasts. A single run over many subjects
  is another, and a larger one — a component library's stories vary exactly one
  prop at a time by construction, which is what
  [`composition.md`](../composition.md) already joins on.
- **How many observations before it is stated.** One contrast where a prop and a
  band moved together is correlation. The table above is trustworthy because
  every other prop was held; a fold over a real suite has no such guarantee, so
  the output needs to distinguish *this prop is the only input that moved* from
  *this prop moved, among others*.
- **What it is reported as.** The useful sentence is a negative: *`Chip` moved in
  `style`, and the only prop of `Chip` that reaches `style` did not change* is a
  much stronger claim than an unexplained movement, and it is the one the ladder
  is missing.

## What it must not do

**Never carry prop values.** The map is names to digests. A prop value can be a
customer record, and the digest exists precisely so that values never leave the
page.

**Never become a gate.** `propsDigest` says outright that it decides who gets
blamed, not whether anything happened, and this inherits that. A prop-to-band
table that has not seen a particular combination must produce *no attribution*,
never *no change*.

**Never include `children`.** For the reason `resolve.ts` gives: `children` *is*
the subtree, and digesting it would make every ancestor's inputs a function of
every descendant's edit, which is the condition that makes root attribution work
at all.

## Leaves behind

One ADR — a props digest is a map, and a component's inputs are named — plus the
row `composition.md` gains below `unexplained`, and a decision about whether the
prop-to-band table is derived per run or accumulated across history, which is the
same question [0002](0002-history-store.md) asks about everything else.

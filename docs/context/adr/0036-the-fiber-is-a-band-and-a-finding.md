# ADR-0036 — the fiber is a band and a finding, not one dimension

**Status:** accepted
**Date:** 2026-08-13
**Relates to:** [ADR-0002](0002-observation-profiles.md),
[ADR-0018](0018-a-component-hash-covers-its-own-nodes.md),
[journal 0019](../journal/0019-what-the-fiber-licenses.md),
[`packages/react/src/wiring.ts`](../../../packages/react/src/wiring.ts),
[`packages/react/src/identity.ts`](../../../packages/react/src/identity.ts)

## Context

The five bands — `structure`, `semantics`, `text`, `style`, `geometry` — all read
the artefact. The artefact is a render in the past tense, and a whole class of
fact never reaches it. Two components can produce a byte-identical document while
differing in every way that decides what happens next.

Measured on React 19.2.8, in
[`fiber.test.tsx`](../../../examples/todomvc/src/fiber.test.tsx) and
[`identity.test.tsx`](../../../packages/react/src/identity.test.tsx):

| two components | what the artefact says | what differs |
|---|---|---|
| `memo(Row)` with `useState` + `useContext`, and a plain `Bare` returning the same `<li>` | identical `innerHTML`; equal `rendering`, `structure`, `semantics`, `text`, `style` | one skips a parent's re-render and re-renders on a theme switch; the other does the exact opposite |
| a list keyed by index, and the same list keyed by id | identical `innerHTML` | a reorder moves each row's state onto its neighbour, or does not |
| a child declared at module scope, and the same child declared inside its parent's body | identical `outerHTML`, identical `rendering`, identical wiring | a counter clicked once reads `1/1` under one and `0/1` under the other |

The first two rows are properties of the revision: read the page again and they
read the same. The third is not — it is a fact about *this* commit relative to a
previous one, and it has no value at all when read once.

Treating all three as one dimension forces a choice, and both directions are
wrong. A single `fiber` digest holding a remount flag would move between two
readings of an unchanged page, which is a hash that reports the instrument. A
single dimension that dropped the remount to stay stable would drop the most
valuable fact the fiber holds.

## Decision

**The fiber splits along a contract that is checkable: read the same page twice
without changing anything, and if the value moved, it is not a band.**

| | reads | shape | where |
|---|---|---|---|
| `wiringOf` | hook shape, wrapper chain, context subscriptions, reconciliation key | a hashed band, `wiring`, on `ComponentInstance` | [`wiring.ts`](../../../packages/react/src/wiring.ts) |
| `remountedSince` | `alternate === null` since a mark | a finding a run reports | [`identity.ts`](../../../packages/react/src/identity.ts) |

The rule is stated as an assertion rather than left as a convention:
[`wiring.test.tsx`](../../../packages/react/src/wiring.test.tsx) reads one page
twice and asserts the two values are equal, and reads it again across an
unrelated re-render that moves `textContent` to `'0/1'` and asserts the wiring
did not move with it.

**`wiring` is a band and is deliberately outside `rendering`.** `rendering` is
the four content digests and its contract is that two instances sharing it
rendered the same thing. A component that gains a `memo()` renders the same
thing. `geometry` is already carried beside `rendering` for the same reason, so
this is the existing shape rather than a new one.

**State values are excluded from the band by the same rule.** `useState(0)`
records `useState` and never `0`. A value moves between readings by design; the
*shape* of the hook call does not.

**Component-level facts attach to a component's root host node only.** `shapeOf`
folds every node a boundary owns, so repeating a hook list on all forty
descendants would make the band depend on how many `<div>`s a component happens
to render. `key` is the exception and attaches to every node that carries one,
because it is a fact about that node's own reconciliation.

**Absent is not empty, in both directions** (ADR-0002). A node this adapter could
not read is absent from the band. A component it read perfectly that declares
nothing reports `{}` — a real observation of nothing, which must not compare
equal to a page with no framework at all.

## Consequences

**No baseline is invalidated.** `wiring` reaches neither `renderHash` nor
`structureHash` nor `styleHash`; `project.ts` lists the fields it hashes
explicitly, so a new `SemanticNode` field cannot be swept into one. A whole new
dimension shipped with the full suite green at 1930 tests and every stored digest
unchanged — which is the property that decides whether a new dimension is
adopted or turned off on the first red morning.

**A hookless component and a production build are one answer.** React
initialises `_debugHookTypes` to `null` and assigns an array only once a hook
runs, so the two are indistinguishable from outside. Both report absent rather
than `[]`. The cost is a real loss: a component that gains its first `useState`
in a development build reads as "became readable" rather than as a change. The
alternative claims something the observation does not support.

**The temporal half needs a caller to mark first.** `remountedSince(root, mark)`
is two calls by construction, because after a page's very first commit every
fiber has `alternate === null` and a one-call `remounted()` would report the
whole page as rebuilt.

**A remount that was asked for and one that was not look identical**, so `key` is
reported rather than filtered on. A remount under a changed key is a decision; a
remount with no key is a defect; this names which it saw rather than deciding.

**Two unkeyed siblings of one component at one depth can be confused** when one
is removed and another added. That is a list without keys, which the wiring band
reports separately, and the two findings are meant to be read together.

## Alternatives

**One `fiber` band holding everything, remounts included.** Rejected: it fails
the band contract on the first re-read, and a digest that changes when nothing
changed is worse than no digest, because it produces work.

**Fold `wiring` into `rendering`.** Rejected: it makes a performance annotation
read as a visual regression, and re-baselines every subject in a corpus the first
time a framework adapter is wired up.

**Hang wiring off `Provenance` rather than the node.** Rejected: provenance
answers *who is responsible for this node*, and this answers *what this component
is*. A band's inputs belong beside `style` and `attributes`, which is where
`shapeOf` looks; putting them one indirection away would mean every future band
reader has to know that one dimension lives somewhere else.

**Record hook state values.** Rejected under the band contract: a value that
moves between two readings of an unchanged page cannot be hashed into a baseline.
It is also the half of the fiber a reader is most likely to want and the half
that would make the dimension untrustworthy.

**Compare fiber `type` identity across commits to detect remounts.** Rejected
because it reports nothing in the case that matters: an inline component gets a
fresh function identity on every parent render, so `type` inequality would
classify the defect as "a different component appeared" and drop the finding.
Identity is matched on name, depth and ordinal instead — deliberately not on
`key`, since a changed key is one of the two ways a remount happens.

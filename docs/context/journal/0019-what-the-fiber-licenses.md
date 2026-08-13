# 0019 — What the fiber licenses

**Date:** 2026-08-13
**Question:** [0018](0018-where-a-change-enters-the-room.md) treated the fiber as
a source of provenance — a place to look up who owns a node. The instruction that
followed was to treat it as a first citizen, equal to HTML and CSS. So: what can
be **reasoned** from the fiber that no amount of HTML and CSS will ever license?

## First, a correction to 0018

0018 read [`mask-fingerprint`](https://github.com/argos-ci/mask-fingerprint) as an
incumbent and scored it — *the difference is the key*, ours survives three things
theirs does not. That was the wrong reading, and the person who supplied the link
said so: it was offered as an example of a **method**, not as a competitor.

The method is: take an observation that cannot answer your question, **derive** a
value from it, and reason over the derived value.

Argos derives from a diff mask — dilate, crop to the bounding box, reduce to a
grid of densities, quantize, hash. No pixel comparison can say *this is the same
defect as last Tuesday*; the derived integer can, in SQL. The claim lives one
layer above the observation, and the derivation is what carries it there.

Read that way, the prop-differential at the end of 0018 is the same move: no
single reading says what `Chip.selected` controls; a set of readings, differenced
band by band, does. And it is the move this entry is about, with the fiber as the
substrate the derivation reads.

| observation | derivation | the claim it licenses |
|---|---|---|
| a mask of differing pixels | dilate, crop, grid, hash | "this is the same shape of defect, six times now" |
| two readings differing in one prop | band-by-band difference | "this prop controls `style` and `semantics`, and nothing else" |
| a fiber's hooks, wrappers, contexts, key | a `wiring` band | "these two identical documents are two different components" |
| a fiber's `alternate`, after a commit | a remount finding | "this instance lost its state, and the document will never tell you" |

Every row is the same shape. The last two are new, and they are the two where the
raw observation is not a picture at all.

## What HTML and CSS structurally cannot say

Every band reads the artefact, and the artefact is a render in the past tense.
What re-renders, what keeps its state, what reorders correctly — all of it is
decided by things that leave no mark on the artefact whatsoever.

Measured, in
[`fiber.test.tsx`](../../../examples/todomvc/src/fiber.test.tsx) through the real
collection path — `collect` → `normalize` → `componentInstances`:

```
memo(Row) { useState; useContext(Theme) }   →  <li class="va-text">Buy milk</li>
function Bare()                             →  <li class="va-text">Buy milk</li>
```

Byte-identical `innerHTML`. Equal `rendering`, equal `structure`, equal
`semantics`, equal `text`, equal `style`. One of these skips its parent's
re-render and wakes on a theme switch; the other does the exact opposite. Nothing
in five bands, and nothing in a pixel, separates them. The `wiring` digests
differ.

The same holds for a list keyed `['0','1','2']` against one keyed `['a','b','c']`
on byte-identical markup, which is the difference between a reorder that moves
each row's state with its row and one that leaves every row's state on its
neighbour — a defect that is fully determined *at the moment of the still* and
recorded in the fiber's `key` field and nowhere else.

## The band contract, stated as an assertion

The third measured pair is where the dimension broke in half.

A child declared inside its parent's body renders identically to the same child
declared at module scope, and produces an identical `rendering` **and an identical
`wiring`**. What separates them only exists between two readings: after one
parent re-render, a counter clicked once reads `1 of 1` under the stable child
and `0 of 1` under the inline one.

So the rule that sorts the dimension had to be written down, and it is checkable:
**read the same page twice without changing anything, and if the value moved, it
is not a band.**

| | reads | shape |
|---|---|---|
| [`wiringOf`](../../../packages/react/src/wiring.ts) | hooks, wrappers, contexts, keys | a hashed band |
| [`remountedSince`](../../../packages/react/src/identity.ts) | `alternate === null` since a mark | a finding, beside `pendingSuspense` |

Whether an instance remounted is a property of the *reading*, not of the
*revision*, so it can never be a baseline. The decision and what it forecloses
are [ADR-0036](../adr/0036-the-fiber-is-a-band-and-a-finding.md).

## What React would and would not say (19.2.8, jsdom)

Everything below was measured with a throwaway probe before any of it was
designed around, which is the only reason the design survived contact.

**`_debugHookTypes` is React's own record**, in call order, so `useState` and
`useReducer` are separated by name rather than by a heuristic that would have to
guess from the outside. It is also initialised to `null` and assigned only once a
hook actually runs — so a **hookless component in a development build reads
exactly like a production build**. Both report absent rather than `[]`, because
`[]` would be a positive claim that this component declares no hooks, and the
band would then report a component gaining its first `useState` as if it had
merely become readable.

**Wrapper chains need the tag *and* the parent.** React collapses `memo(fn)` for a
plain function into one `SimpleMemoComponent` fiber, and keeps a separate
`MemoComponent` wrapper for every other case: `memo(forwardRef(f))` is a `14 → 11`
pair. Reading `fiber.tag` alone reports it as a bare `forwardRef`.

**The key is on whichever fiber React put it on.** `<li key="a">` puts it on the
host fiber, `<Row key="r"/>` on `Row`'s composite, `memo(forwardRef(Row))` with a
key on the wrapper above that. Three places, one authored `key={…}`, so the walk
collects the last non-null key it passes on the way up rather than reading either
end.

**`detachFiberMutation` nulls `return` on a torn-down fiber.** This one cost an
afternoon: a depth computed from the *old* fiber at compare time is always zero,
so the identity match silently matched nothing and a page full of remounts
reported none. Identity has to be recorded at mark time. The fix turned the mark
into a `WeakSet` plus a list of recorded keys, which also removed a strong
reference into React's tree — a mark that pinned exactly the torn-down subtrees it
exists to report.

**A keyed remount is indistinguishable from an accidental one.** Both are
`alternate === null` on a fiber standing where one stood before. So the key is
*reported*, not filtered on: with a key, somebody asked for it; without one,
nothing did.

**A component that renders only another component owns no host node**, so the
walk had to return every composite between an element and the first host above
it. `InnerRow` returning `<Counter/>` is the component the author wrote and the
one whose remount explains the other, and a report naming only `Counter` points
at the symptom. They come back outermost-first, so `remounted[0]` is the cause.

## What it cost

Nothing that was already stored. `wiring` sits beside `rendering` rather than
inside it — the same position `geometry` already holds — so no `renderHash`,
`structureHash` or `styleHash` moved, and the full suite passed at 1930 with a
whole new dimension shipped. That was a design goal rather than a happy accident:
a dimension that re-baselines a corpus on the morning it lands is a dimension
people turn off.

The one line that turns it on, in the collector:

```ts
collect(subject, { …, provenanceOf, wiringOf, portalsOf: portalContentOf })
```

Without it the band is **absent**, not empty — a page nobody read must not compare
equal to a page with no framework, and a component read perfectly that declares
nothing reports `{}` rather than nothing at all (ADR-0002).

## What this changes about the argument

0018 ended on a sentence about layers: a tool that only sees pixels cannot build a
key for a component, because by the time it looks the components are gone. This
entry is the other end of the same sentence.

The fiber is not a convenience for looking up names. It is the only layer where
the *consequences* are still written down — where "this will lose your typing on
the next keystroke" is a fact you can read off a still frame. Five bands describe
what a page **is**. The sixth, and the finding beside it, describe what it will
**do**, and no serializer of HTML and CSS will ever be able to derive that,
because the evidence was consumed before the artefact existed.

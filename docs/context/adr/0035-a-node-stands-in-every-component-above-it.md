# ADR-0035 — a node stands in every component above it, not only the nearest

**Status:** accepted
**Date:** 2026-08-12
**Amends:** [ADR-0007](0007-subject-boundary-is-the-component-tree.md) (which
settles where a subject ends, not how many boundaries one element opens)
**Relates to:** [ADR-0018](0018-a-component-hash-covers-its-own-nodes.md),
[ADR-0033](0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md),
[`composition.md`](../../composition.md)

## Context

`Provenance.owners` is the full chain of composite components standing over a
node, innermost first, and each frame carries the name, the props digest and the
component that placed *that* element. The boundary walk read `owners[0]` and
discarded the rest.

Two consequences, both measured on
[`examples/todomvc`](../../../examples/todomvc).

**A component that renders only components was a boundary nowhere.** `TodoApp`
returns a `Card`, which returns a `Stack`. One `div`, three components, and only
`Stack` had a boundary — so `TodoApp`, `TodoHeader`, `TodoList` and `TodoFooter`
appeared in no census entry, had no hash, no props class and no example, while
being the four files a reviewer opens to change anything about the application.
The census had eight of the twelve components, and the missing four were the
interesting end.

**A container absorbed its caller's content.** With only the innermost owner
known, a node handed to `Card` as `children` was indistinguishable from a node
`Card` wrote, so `Card`'s hash covered whatever it was passed. Its props digest
excludes `children` and therefore said its inputs held — a component moving with
its inputs unchanged, which is the exact shape the `contradicted` rung reads as
evidence.

The information to fix both was already collected. The walk was throwing it away.

## Decision

**A node opens a boundary for every component in its ownership stack that the
previous node did not already have open.**

The stack is `owners` reversed — outermost first — with `createdBy` appended as a
further rung where the node's author differs from its innermost owner, which is
markup slotted into a container. Walking in document order, a node opens
boundaries from the first rung where its stack diverges from its parent's, so
`TodoApp` → `Card` → `Stack` opens three nested boundaries at one element and
each carries its own props digest and its own placer.

**A boundary holds a node when the node's stack ends exactly at that boundary's
rung.** Everything else is a child boundary, and appears in the shape as a
placeholder.

**A placeholder names the child only when this boundary placed it.** Where
`placedBy` is some other component, the child arrived as `children` and the
placeholder is an anonymous hole. A container is not told what it was handed, so
its hash must not depend on it.

## Consequences

**The census is the component list.** Twelve of twelve on todomvc, and the four
app components have hashes, props classes and examples: `page/footer--counts` is
an example of `TodoFooter`, and the five page stories are examples of `TodoApp`.
An organism too large to describe in full is still watchable.

**Containment is measurable, and is measured.**
[`closure.test.tsx`](../../../examples/todomvc/src/closure.test.tsx) applies a
`.va-button` edit across all fifteen stories and asserts the set of components
whose own content moves is exactly `['Button']` — every component enclosing a
button on every page unmoved. The corner-radius token moves five, which is the
five that read it.

**`Card`'s hash no longer depends on its caller**, so the pairs ADR-0034's second
refusal exists to catch are fewer at the source rather than only at the check.
The refusals stay: `digestableProps` still excludes `children`, and text content
folded into a parent element still varies with what a caller passed.

**Depth and rung are different numbers and both are kept.** `depth` counts
enclosing boundaries; `rung` is the position in the ownership stack. They diverge
wherever a subject root has no provenance, and code that conflated them would
name the wrong component for a boundary that is not the innermost at its node.

**A container still moves when its child count changes.** One hole per foreign
child, so a caller passing three where it passed two produces a different
structure digest. This is a real signal reported at the container rather than the
caller, and it is the residual cost of the decision.

**A production build degrades to the previous answer, not to a wrong one.**
Without `_debugOwner`, `placedBy` is undefined everywhere, every placeholder names
its child, and boundaries fall back to enclosure. Coarser, never wrong in a new
direction.

## Alternatives

**Name the author in the placeholder** — `{by: 'TodoFooter'}` rather than an
anonymous hole. Rejected because it breaks the join it was meant to protect: the
same `Stack` rendering under `ds/chip--group` and under `TodoFooter` would get
different bytes, so two subjects watching identical output would never echo.

**Collapse consecutive slots into one placeholder**, making a container immune to
arity. Rejected: a caller adding a fourth chip to a row is a real change to that
row, and a container that cannot see it is a container whose hash says a page
assembled the same way when it did not.

**Keep reading `owners[0]` and patch the namespace mismatch at each consumer.**
This is what the ranking site already did — a cause list named for enclosures
against a region named for its author, reconciled with `createdBy ?? owners[0]`
in four separate files. Four patches for one defect, each one a chance to
disagree about which name a component has.

**Give slotted markup the container's props digest** rather than leaving it
absent. Rejected under ADR-0002: it would claim the author was called with inputs
it never saw, and a wrong digest joins wrongly where an absent one joins not at
all.

# ADR-0033 — the component that mounted it is not the one it sits in

**Status:** accepted
**Date:** 2026-08-12
**Extends:** ADR-0007 (a subject's boundary is the component tree, not DOM
containment)
**Relates to:** [`composition.md`](../../composition.md),
[ADR-0018](0018-a-component-hash-covers-its-own-nodes.md)

## Context

ADR-0007 settled that a subject's boundaries are the component tree rather than
DOM containment. It did not write down the consequence that decides whether a
component graph is useful:

> A component that renders nothing but other components authors no DOM node, and
> is therefore **a boundary nowhere**.

Measured on [`examples/todomvc`](../../../examples/todomvc): the census has eight
components, and `TodoApp`, `TodoHeader`, `TodoList` and `TodoFooter` are in none
of them. Those four are the application. They are also the four files somebody
opens to change anything, and a graph recording only enclosure cannot see them at
all.

Enclosure was the only edge the first cut recorded, and on real code it names
layout primitives. Every `Chip` in that application is `within: Stack`. Every
`Toggle` is `within: Stack`. `Stack` is a flexbox wrapper that knows nothing
about chips, and an attribution ladder consulting it finds a component nobody
edited and reports five unexplained movements where there is one caller.

## Decision

**A component's upward edge is two edges, and the one that explains a change is
the one that wrote the element.**

Three parts, each of which is a defect if it goes the other way.

**Both are recorded, because neither derives the other.** `within` is the
component whose boundary encloses this one — where it *sits*, which is what a
reader means by "where is this on the page". `createdBy` is React's owner: who
authored the element, which is where its props are written. On todomvc they
differ for every component that has both, and there is no rule that recovers one
from the other: enclosure is a fact about the rendered tree and authorship is a
fact about the source.

**The `upstream` rung reads `createdBy` first, and it is not a tie-break.** An
edit changes a component's inputs by changing the call site, and the call site is
the owner. Consulting enclosure first would let a layout primitive absorb the
explanation whenever one happens to be in between, which on this application is
always. Enclosure remains the fallback, because it is a real edge and *something
upstream changed* is a better sentence than silence.

**An empty `createdBy` is not "nothing mounted it".** React's owner links are a
development-build artifact, so a production build produces an empty list for
every component in the suite. Absent, empty and "mounted by nothing" are three
states, and collapsing them would turn a stripped build into a confident claim
that nothing in the application calls anything.

## Consequences

**A production build silently loses the rung that works.** The ladder degrades
to enclosure, which is where it was before this decision, and the report cannot
say that it degraded: the artifact records no build mode, so an empty
`createdBy` on a production run is indistinguishable from a component genuinely
mounted by nothing. The tool prints both possibilities beside the empty list and
verifies neither, which is the honest form of an answer nothing here can check.

**A boundary-nowhere component has to be answered from the reverse edge.**
`variance_composition` asked about `TodoFooter` finds no census entry and must
scan every entry's `createdBy` to say what it mounted. That is a special case in
the tool and a scan that grows with the census — accepted, because the
alternative is answering "no such component" about the one name that explains
the run.

**Two edges are two things a reader can confuse.** They are printed on adjacent
lines with different words (`within`, `created by`) rather than merged into a
plausible-sounding `parent`, and the type carries the distinction in prose. A
consumer that reads `within` expecting authorship gets a layout primitive and no
warning.

## Alternatives

**Record only `createdBy`.** Rejected on both ends. It is the edge that vanishes
on a production build, so a graph built on it alone is empty exactly where a
real deployment is; and enclosure answers a question authorship does not — *what
is this inside* is what a reviewer looking at a screenshot is asking.

**Record only `within`, and recover the caller from the source index.** The
index maps a component name to the files that declare it, which is not the same
as knowing who calls it, and it is blind to the case that motivated this: a
component rendering no DOM is not in the graph to be looked up. It would also
put a static-analysis answer beside a set of runtime-measured ones, where a
disagreement between them has no adjudicator.

**Give every mounting component a synthetic census entry.** Correct-sounding,
and rejected on what the counts would then mean. An entry with zero boundaries
and zero renderings still appears in "12 component(s) across 15 subject(s)", and
that headline is the sentence people read. A component with no boundary has no
rendering to join on, no digest to compare and no site to hold — it would be a
row that exists to avoid an awkward absence, which is the opposite of what the
absence is for.

**Report the mounting component only when the ladder needs it.** Rejected
because the graph is read by things that are not the ladder. The census answer
for `Chip` is materially different when it names `TodoFooter`, and computing the
edge and then withholding it from every reader but one is a decision taken in
the wrong place.

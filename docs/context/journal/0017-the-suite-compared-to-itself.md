# 0017 — The four components that matter are in no census

**Date:** 2026-08-12
**Question:** a suite's examples are components built from components. Can they
explain each other, and does that get any closer to *this is a flake*?

Every comparison in this system had been one subject against its baseline. The
other axis — many subjects, one revision, joined on the components they share —
had never been read, and it is available for free: a run already holds, for each
subject, the component boundaries the document contained and a digest of what
each rendered. This is what the join found, including the two things it got
wrong first.

Measured on [`examples/todomvc`](../../../examples/todomvc): 15 stories, React,
a development build, one Mac. Every number below is an assertion in
[`composition.test.tsx`](../../../examples/todomvc/src/composition.test.tsx).

## The census has eight components and the application is not in it

`Button`, `Card`, `Chip`, `Stack`, `Text`, `TextField`, `TodoItem`, `Toggle`.

`TodoApp`, `TodoHeader`, `TodoList` and `TodoFooter` are in **no** entry. Each
of them renders nothing but other components, authors no DOM node of its own,
and is therefore a boundary nowhere. They are also the four files a reviewer
opens to change anything about this application.

That is the consequence of ADR-0007 that nobody had written down, and the first
cut of the graph walked straight into it. It recorded one upward edge —
enclosure — and on real code enclosure names layout primitives:

| | `within` | `created by` |
|---|---|---|
| `Chip` | `Stack` | `TodoFooter` |
| `Toggle` | `Stack` | `TodoItem` |
| `TextField` | `(unattributed)`, `Stack` | `TodoHeader` |

`Stack` is a flexbox wrapper that knows nothing about chips. An attribution
ladder consulting it, on an edit to `src/app/todo.tsx`, finds a component nobody
touched — measured directly: no name in `Chip.within` is declared in the edited
file. Reading React's owner instead, the same edit explains the chip movements
through `TodoFooter` and the report names one caller instead of five
unexplained movements.

So both edges are recorded and the ladder reads authorship first
([ADR-0033](../adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)).
The cost is stated there and is real: `_debugOwner` is a development-build
artifact, so on a production bundle the good rung is silently empty, and the
artifact records no build mode to distinguish that from a component genuinely
mounted by nothing.

## Eleven divergences, and all eleven were the field the digest excludes

A divergence is one props digest producing more than one rendering at one
commit. The first implementation reported **eleven** on this suite. Every one
was false, in three different ways.

`digestableProps` excludes `children`, which is correct and load-bearing —
children are elements, and digesting them would make a props digest a digest of
the whole subtree, joining nothing with anything. But it means a props digest is
**not a statement of a component's inputs**, and "the same inputs rendered two
ways" cannot be built on one without saying what it does about the gap.

| what it reported | what it was |
|---|---|
| `TextField` diverging | one subject walked as two boundaries — two places on a page, allowed to differ |
| `Card`, `Text` diverging | different children, identical props digest, because the omitted field was the one that differed |
| the rest | different components mounted below, so different elements were passed in |

With the three refusals in place
([ADR-0034](../adr/0034-a-divergence-must-survive-the-children-it-excludes.md)),
the answer is **zero**, and zero is correct: nothing in this suite renders two
ways from one input. Eleven→zero is the shape of this whole entry — the join
produces plausible findings immediately, and the work is in refusing the ones
that are artifacts of how the digests were built.

`Card` still has one props class and two renderings, which is the honest residue:
the count says the pair exists and the refusals say it is not evidence.

## Twenty-one echoes, and one finding nobody asked for

An echo is one rendering digest with sites in more than one subject. **21**, and
every one crosses a subject boundary — three identical chips in one list are not
an echo, because there is nothing to connect. The widest is a `Chip` rendering
shared by `ds/chip--group` and four page stories: the design-system story and
the pages are watching literally the same bytes, so one diff review covers all
five, and the story is the narrow place to do it.

Then the negative result:

> The three `ds/button--*` stories produce **no** echo into the application at
> all. Every shared `Button` rendering in this suite is shared between pages.

The design-system examples guard a component whose real usage they never touch.
Nothing about that is a defect in the tool — it is this suite's own coverage,
stated out loud for the first time, and it is now an assertion rather than a
paragraph.

`Chip` has 21 instances and **no example of its own**: no subject's shallowest
boundary is a `Chip`, so a change to it is always reviewed through whatever page
contains it. That is a suite-shaped fact the per-subject tools cannot phrase.

## What it bought on the flake question

The chain that motivated this: detect a pixel change, find the HTML area, find
no related change, call it a flake. The first three steps existed. The fourth
needed *no related change* to be evidence rather than an absence, and the join
supplies the missing half — **the stable states to refer to are the other sites
of the same rendering**, and the run already had them.

Every component the run found moving now walks a ladder — `edited`, `token`,
`upstream`, `contradicted`, `unexplained` — and each unexplained movement
carries `held`: the subjects where the same component, with the same props, did
not move. Measured: an edit to `src/tokens/foundation.ts`, which declares no
component here, produces exactly one unexplained `Chip` movement with a
non-empty control group.

**And it still refuses to call that a flake.** The position has not moved: a
subject is unstable when it fails to read the same way twice, and one reading
cannot establish it. So the same movement is `suspect` on its own and `flake`
only when a second reading of that subject also disagreed — two instruments, one
run, both halves of the sentence. The test asserts the transition in both
directions.

What this did **not** buy: the sweep still reads every subject in plan order.
The shortlist is sorted by how much control the suite has over each entry and
nothing points `--flakes` at it yet.

## What it cost, and what it does not survive

One fold over instances the subjects already reported, in plan order so a fast
machine and a slow one produce the same bytes. No browser, no image, no store.

The full graph is one entry per boundary per subject — tens of thousands of
objects on a real suite — so the artifact keeps names, counts and subject lists,
caps the echo list at 100 and **counts what the cap dropped**. A consumer
wanting the graph recomputes it from the snapshots.

It does not survive a shard split, and the merge behind
`variance report shard-1.json shard-2.json …` says so rather than unioning two
partial graphs. Two subjects sharing a rendering *are* the finding;
a pair that landed in different shards is in neither report, so a union would
have every cross-shard edge missing and the `held` lists silently short — which
is the evidence behind calling something a flake. A dropped section that says
nothing reads as *the suite stopped sharing components*.

## Limits

One application, 15 stories, 8 components, one framework, one development build,
one machine. The cross-subject work has never seen a real change set: every
attribution above is driven by a declared file list rather than by a `--since`
against a repository's history.

Provenance is React's. A suite built on anything else composes nothing at all
and says so — [spec 0019](../../specs/0019-provenance-without-react.md) is the
vacancy.

And the divergence refusals trade a measured 100% false-positive rate for a
false-negative rate nobody here can measure. A component whose two renderings
genuinely disagree *and* happen to mount different subtrees is refused by the
third rule and nothing counts it.

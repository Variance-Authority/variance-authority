# The suite compared to itself

Every other comparison in this system is one subject against its baseline: two
revisions, one thing. Composition is the other axis — **many subjects, one
revision, joined on the components they share**. There is no baseline anywhere
in it.

> A visual-regression example is a component built from components. The example
> *is* a component, at a boundary; the same component appears again, with the
> same or different props, inside larger examples.

That sentence is a join key. A run holds, for every subject it observed, the
component boundaries the document contained and a digest of what each one
rendered ([ADR-0018](context/adr/0018-a-component-hash-covers-its-own-nodes.md)).
Once those boundaries are addressable across subjects, one commit's worth of
snapshots answers three questions no per-subject comparison can reach:

- **Which examples are watching the same bytes.** Two diffs over one shared
  rendering are one thing to review, and the narrow example among them is where
  to review it.
- **Which of them disagree at this commit.** Not a regression — there is no
  baseline in it — but proof that something outside a component's own inputs
  decides part of its output.
- **What, in this run, explains each thing that moved.** An edited file, a moved
  token, an edited *caller* — or nothing, which is a finding of its own.

No second render, no second image, no store. It is a fold over digests the
collection already produced.

## Turning it on

Nothing. It runs inside `variance run` whenever the collection produced semantic
snapshots, and the section is in the artifact:

```bash
variance run                     # composes, and prints the section
variance report                  # the same section, from the file, later
```

An agent asks for it by name:

```ts
toolByName('variance_composition')?.run(report, {});
toolByName('variance_composition')?.run(report, { component: 'Chip' });
```

**Absent on a raster-only or ephemeral tier**, which has no boundaries to join.
Absent is not empty: the tool answers with a sentence saying the run cannot tell,
because an empty graph printed there would read as *this suite shares nothing*,
which is a different claim and a false one.

**Absent from a merged report** — `variance report shard-1.json shard-2.json …`
— and the merge says so in a warning rather than leaving a hole. Two subjects
sharing a rendering *are* the finding, so a pair that landed in different shards
is in neither shard's report and a union of the shard graphs would be a graph
with every cross-shard edge missing and nothing marking where.

## Two relations run upward, and they are not the same relation

**Parent** is what a node is *inside*: React's `return` chain, the boxes it
ended up in. **Owner** is what *rendered* it: the code that wrote the element. A
layout wrapper is the parent of everything handed to it and the owner of none of
it.

Boundaries are placed by owner. Every component standing over an element holds a
boundary at that element, nested outermost-first — so three components that
return one another share one `div` and hold three boundaries on it, and **a
component that renders nothing but other components is still a component**.

Each boundary then carries both relations, because they answer different
questions:

| edge | means | on todomvc's `Chip` |
|---|---|---|
| `within` | the boundary that encloses this one | `Stack` |
| `created by` | the component that wrote this element | `TodoFooter` |

`within` is where a boundary sits, which is frequently a layout primitive that
knows nothing about its contents. `created by` is who wrote the element, which is
where the props are written and therefore what an edit to it changes. Measured on
[`examples/todomvc`](../examples/todomvc): every `Chip` is `within: Stack` and
`created by: TodoFooter`; `Toggle` is `within: Stack`, `created by: TodoItem`;
`TextField` is created by `TodoHeader`. Across the whole suite the mounting edge
names five components and every one of them is a file a reviewer edits, while the
enclosing edge adds `Stack` and `Card` — the two nobody does.

**`created by` is empty on a production build**, where React's owner links are
gone. Empty is *not* "nothing mounted it", and nothing here reads it that way. A
run without owner links still places boundaries and still names enclosures; it
loses the caller, not the graph.

## A component's hash covers its own nodes, and that is what makes it a unit

Inside a boundary, a child boundary is a placeholder rather than its content.
Where the enclosing component placed the child, the placeholder names it; where
the child arrived as `children` from somewhere else, the placeholder is an
anonymous hole — a container is not told what it was handed, so its hash must not
depend on it.

That containment is the property the whole page rests on, so it is measured
against the whole suite rather than argued
([`closure.test.tsx`](../examples/todomvc/src/closure.test.tsx)):

| edit | components whose own content moves |
|---|---|
| padding on `.va-button` | `Button` |
| the corner-radius token | `Button`, `Card`, `Chip`, `TextField`, `Toggle` |

The first row is the claim a design system needs to be able to make about its own
change: one component moved, and **the eleven others did not** — including every
component that encloses a `Button` on every page in the suite. The second is the
same rule in the other direction: a foundation edit is *supposed* to cross
components, and the answer is the five that resolve through that token rather
than everything on a page containing one.

What the placeholder still carries is the *number* of children handed in, so a
caller passing three where it passed two moves the container. That residual limit
is stated in
[ADR-0035](context/adr/0035-a-node-stands-in-every-component-above-it.md).

## What it answers

### Two examples watching the same bytes

An **echo** is one rendering digest with sites in more than one subject. Three
identical chips in one list say nothing; the same chip in a chip story and in a
page footer says that a reviewer looking at two diffs is looking at one.

Measured on todomvc — 15 stories, 12 components — **26 shared renderings**, every
one of them spanning more than one subject. The widest is a `Chip` rendering
shared by `ds/chip--group` and four page stories, so the design-system story and
the pages are, for that chip, watching the same bytes, and the story is the narrow
place to review a change to it.

The same measurement produces a finding nobody asks for:

> The three `ds/button--*` stories produce **no** echo into the application at
> all. Every `Button` rendering shared between subjects is shared between pages.

The design-system examples guard a component whose real usage they never touch.
That is not a defect in the tool; it is the suite's own coverage, and it is a test
in [`composition.test.tsx`](../examples/todomvc/src/composition.test.tsx) rather
than a paragraph.

### Which layer a subject is an example of

A subject's **example** is its shallowest boundary — the component the subject
exists to show. On a suite built in layers this is where a design system finds out
what it has actually covered:

| subject | example of | what that means |
|---|---|---|
| `ds/button--default` | `Button` | an atom, shown directly |
| `ds/chip--group` | `Stack` | a `Stack` laying out chips. `Chip` has 21 instances and no example of its own |
| `page/footer--counts` | `TodoFooter` | a molecule, shown directly |
| `page/todos--populated` | `TodoApp` | the organism |

`ds/text--scale`, `ds/toggle--states` and `ds/chip--group` all wrap their subject
in a layout component, so all three are examples of `Stack`, and `Text`, `Toggle`
and `Chip` have none. A change to any of the three is reviewed through whatever
page contains it. That is one wrapper away from being fixed and it is invisible
until the suite is joined to itself.

The organism end holds the opposite result. `TodoApp` is too large to describe in
full and nobody would write a story for its internals — but it is a boundary with
a hash, five instances and five examples, so it can be *watched* without being
described, and an edit inside it resolves to the molecule that moved rather than
to the whole page.

### One input, two renderings

A **divergence** is one props digest producing more than one rendering *at one
commit*. It is not a regression. It says the component's own inputs do not
determine its output, which is either a fact about the design — a token, a theme,
an ancestor's cascade — or a reading that is not repeatable. The bands say which
kind, in the same vocabulary a sensitivity absorbs, so a divergence entirely
inside a relaxed band can be dismissed without opening it.

**Measured on todomvc: zero.** A props digest excludes `children` by
construction, so three shapes reach the check and are refused by it
([ADR-0034](context/adr/0034-a-divergence-must-survive-the-children-it-excludes.md)):

| shape | why it is not a divergence |
|---|---|
| Two boundaries of one component in one subject | Different nodes, not two renderings of one node |
| Different `children`, same props digest | The excluded field is the one that differs |
| Different rendered subtrees | Two sites that mount different components below them did not receive one input |

Zero is a real and common answer, and it means nothing in the suite renders two
ways from one input. `Card` keeps one props class and two renderings, which is the
honest residue: the count says the pair exists and the refusals say it is not
evidence.

### Why a component moved

For every component the run found to have moved — from a diff region it named as
a *cause*, or from a second reading that disagreed with the first — the run walks
a ladder and stops at the first rung that holds:

| rung | what it found | what it prints |
|---|---|---|
| `edited` | a file declaring this component is in the change set | the file |
| `token` | a custom property *its own nodes* resolve through moved in this run | the tokens |
| `upstream` | a component that mounted it, or encloses it, was edited | the caller |
| `contradicted` | it renders two ways from one input at this commit | the divergence |
| `unexplained` | none of the above | the finding |

`edited` and `token` need [`--since`](selecting.md), and a run that did not ask
cannot reach either. That degrades honestly: an unexplained movement in a run with
no change set carries a sentence saying so instead of an accusation.

**The `upstream` rung reads `created by` before `within`, and that is not a
tie-break.** The component that wrote the element is the one whose edit changed
this component's inputs. On todomvc, an edit to `src/app/todo.tsx` explains five
chip movements through `TodoFooter`; a run consulting only `within` finds `Stack`,
which nobody edited, and reports five unexplained movements instead of one caller.

`token` is read off the component's own instances rather than off the subject,
which is what makes it worth anything: every subject on a themed page resolves
through every token in the theme, so a subject-level intersection names them all
and explains nothing.

An unexplained movement is where this page stops. What the run does with one — the
control group beside it, and the second instrument that turns it into a verdict —
belongs to [`flakiness.md`](flakiness.md#nothing-in-this-run-explains-it).

## What it costs

One pass over the instances every subject already reported, after the worker pool
and in plan order, so a slower machine that finishes subject 41 before subject 3
produces the same bytes. No browser, no image, no disk, no service.

What reaches the artifact is smaller than what produced it. The full graph carries
one entry per boundary per subject — tens of thousands of objects on a real suite
— and a report is a file people open, so the record keeps the names, the counts
and the subject lists, and a consumer that wants the graph recomputes it from the
snapshots. The echo list is capped at 100 and what the cap left out is counted in
the artifact, because a cap that says nothing reads as coverage.

## What this refuses to conclude

**An unexplained movement is not a flake.** It is a movement this run cannot
explain, which is a statement about the evidence the run assembled and not about
the subject. `variance run --flakes` is what settles one.

**Zero divergences is not "the components are deterministic".** It is "nothing in
this suite rendered two ways from one *props digest*, in the shapes the exclusion
of `children` could not explain". A component whose output depends on something no
subject varied is invisible here.

**An empty `created by` is not "nothing mounted it".** It is a production build,
where the owner links are gone. Every consumer of that field keeps the two apart,
and the report's own types say so.

**Provenance is React's.** The boundaries come from the fiber tree, so a suite
built on anything else composes nothing at all — the raster tier's answer, with
the same honest absence.
[Spec 0019](specs/0019-provenance-without-react.md) is the vacancy.

**It is measured on one application.** Fifteen stories, twelve components, one
framework, one development build, one machine, and a change set declared by the
example rather than read from a repository's history. Every number on this page is
an assertion in
[`composition.test.tsx`](../examples/todomvc/src/composition.test.tsx) and
[`closure.test.tsx`](../examples/todomvc/src/closure.test.tsx), which are small
enough that their measurements are the claim.

---

**Further:** [`instruments.md`](instruments.md) for where this axis sits among the
others ·
[`flakiness.md`](flakiness.md#nothing-in-this-run-explains-it) for
what an unexplained movement becomes ·
[`history.md`](history.md) for the same questions across runs ·
[`packages/mcp`](../packages/mcp) for `variance_composition` ·
[ADR-0033](context/adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)
for why `created by` is recorded beside `within` ·
[ADR-0035](context/adr/0035-a-node-stands-in-every-component-above-it.md)
for what a child boundary contributes to its container's hash.

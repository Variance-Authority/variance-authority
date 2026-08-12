# The suite compared to itself

Every comparison in this system is one subject against its baseline: two
revisions, one thing. A suite of examples has a second axis, and until 2026-08-12
nothing read it.

> A visual-regression example is a component built from components. The example
> *is* a component, at a boundary; the same component appears again, with the
> same or different props, inside larger examples.

That sentence is a join key. A run already holds, for every subject it observed,
the component boundaries the document actually contained and a digest of what
each one rendered ([ADR-0018](context/adr/0018-a-component-hash-covers-its-own-nodes.md)).
Once those boundaries are addressable across subjects, one commit's worth of
snapshots answers three questions no per-subject comparison can reach:

- **Which of these examples are watching the same bytes.** Two diffs over one
  shared rendering are one thing to review, and the narrow story among them is
  where to review it.
- **Which of them disagree at this commit.** Not a regression — there is no
  baseline anywhere in it — but proof that something outside a component's own
  inputs decides part of its output.
- **What, in this run, explains each thing that moved.** An edited file, a moved
  token, an edited *caller* — or nothing, which is the finding.

No second render, no second image, and no store. It is a fold over digests the
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
Absent is not empty: the tool answers that question with a sentence saying the
run cannot tell, because an empty graph printed there would read as *this suite
shares nothing*, which is a different claim and a false one.

**Absent from a merged report** — `variance report shard-1.json shard-2.json …`
— and the merge says so in a warning rather than leaving a hole. Two
subjects sharing a rendering are the finding; a pair that landed in different
shards is in neither shard's report, so a union of the shard graphs would be a
graph with every cross-shard edge missing and nothing marking where.

## What a boundary is

A node whose owning component differs from its parent's, plus the subject root
([ADR-0007](context/adr/0007-subject-boundary-is-the-component-tree.md)). The
consequence is the thing everybody trips on once:

> A component that renders nothing but other components authors no DOM node, and
> is therefore **a boundary nowhere**.

Measured on [`examples/todomvc`](../examples/todomvc) — 15 stories, React, a
development build — the census has eight components: `Button`, `Card`, `Chip`,
`Stack`, `Text`, `TextField`, `TodoItem`, `Toggle`. `TodoApp`, `TodoHeader`,
`TodoList` and `TodoFooter` are in **no** census entry, because each of them
composes design-system components and emits no element of its own. They are also
the four files a reviewer would open.

So every component carries two upward edges, and they answer different
questions:

| edge | means | on todomvc's `Chip` |
|---|---|---|
| `within` | the component whose boundary encloses this one | `Stack` |
| `created by` | the component that *mounted* the element | `TodoFooter` |

`within` is where a boundary sits, which is frequently a layout wrapper that
knows nothing about its contents. `created by` is who wrote the element, which
is where the props are written and therefore what an edit to it changes. Every
`Chip` in that application is `within: Stack` and `created by: TodoFooter`;
`Toggle` is `within: Stack` and `created by: TodoItem`; `TextField` is created
by `TodoHeader`. A run consulting only `within` reaches a layout primitive every
time.

**`created by` is empty on a production build**, where React's owner links are
gone. Empty is *not* "nothing mounted it", and nothing here reads it that way.

## What it answers

### Two examples watching the same bytes

An **echo** is one rendering digest with sites in more than one subject. Three
identical chips in one list say nothing; the same chip in a chip story and in a
page footer says that a reviewer looking at two diffs is looking at one.

Measured on todomvc: **21 shared renderings**, every one of them spanning more
than one subject. The widest is a `Chip` rendering shared by `ds/chip--group`
and four page stories — so the design-system story and the pages are, for that
chip, watching the same bytes, and the story is the narrow place to review a
change to it.

The same measurement produced a finding nobody asked for:

> The three `ds/button--*` stories produce **no** echo into the application at
> all. Every `Button` rendering shared between subjects is shared between pages.

The design-system examples guard a component whose real usage they never touch.
That is not a defect in the tool; it is the suite's own coverage, said out loud
for the first time, and it is asserted as a test in
[`composition.test.tsx`](../examples/todomvc/src/composition.test.tsx) rather
than papered over.

The report also names components with **no example of their own** — ones that
appear only inside larger subjects, so a change to them is reviewed through
whatever page happens to contain it.

### One input, two renderings

A **divergence** is one props digest producing more than one rendering *at one
commit*. It is not a regression. It says the component's own inputs do not
determine its output, which is either a fact about the design — a token, a
theme, an ancestor's cascade — or a reading that is not repeatable. The bands
say which kind, in the same vocabulary a sensitivity absorbs, so a divergence
entirely inside a relaxed band can be dismissed without opening it.

**Measured on todomvc: exactly zero.** That number is the interesting one,
because the first implementation reported **eleven**, and all eleven were false.
A props digest excludes `children` by construction, so three shapes had to be
refused before the answer meant anything:

| shape | why it is not a divergence |
|---|---|
| Two boundaries of one component in one subject | One `TextField` walked as two boundaries sharing a props digest. Different nodes, not different renderings of one node. |
| Different `children`, same props digest | `Card` and `Text` "diverged" purely because the excluded field is the one that differed. |
| Different rendered subtrees | Two sites that mount different components below them are not one input. |

Zero is a real and common answer, and it means nothing in the suite rendered two
ways from one input.

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
cannot reach either. That degrades honestly rather than silently: an unexplained
movement in a run with no change set carries a sentence saying so instead of an
accusation.

**The `upstream` rung reads `created by` before `within`, and that is not a
tie-break.** The component that wrote the element is the one whose edit changed
this component's inputs. On todomvc, an edit to `src/app/todo.tsx` explains five
chip movements through `TodoFooter`; a run consulting only `within` would find
`Stack`, which nobody edited, and report five unexplained movements instead of
one caller.

`token` is read off the component's own instances rather than off the subject,
which is what makes it worth anything: every subject on a themed page resolves
through every token in the theme, so a subject-level intersection names them all
and explains nothing.

## The flake half

The chain this page exists to close:

> Detect a pixel change. Find the HTML area behind it. Find no related change.
> Call it a flake.

The first three steps were already built — the region, the component, the ladder
above. The fourth is where this stops, deliberately, and the stopping point has
two names:

| standing | what the run has | what it means |
|---|---|---|
| `flake` | an unexplained movement **and** a subject that failed to read the same way twice | both halves of the sentence, together, in one run |
| `suspect` | an unexplained movement in a subject nobody has read twice | a shortlist entry, not a verdict |

The position in [`flakiness.md`](flakiness.md) has not moved: a subject is
unstable when it fails to read the same way twice, and one reading can never
establish that. What an unexplained movement *is*, exactly, is **the shortlist
of subjects worth reading twice** — ordered by how much control the suite has
over each, so a component that rendered identically in six other places and
moved here sorts above one that appears nowhere else.

**The sweep does not read that shortlist yet.** `variance run --flakes` still
reads every subject, in plan order, and the shortlist is something a person or
an agent spends. Ordering the sweep by it is a change to
[`again.ts`](../packages/cli/src/commands/again.ts) that this work did not make.

**The control group is what makes any of this evidence.** Beside each movement
the run prints `held`: the subjects where that same component, with the same
props, did *not* move. Those are the stable states to refer to, and the suite
already had them — they are the other sites of the same rendering. An empty
`held` list weakens a finding rather than strengthening it, which is why it is a
list and not a flag, and why the shortlist is ordered by how much control the
suite has over each entry.

## What it costs

One pass over the instances every subject already reported, after the worker
pool and in plan order, so a slower machine that finished subject 41 before
subject 3 produces the same bytes. No browser, no image, no disk, no service.

What reaches the artifact is smaller than what produced it. The full graph
carries one entry per boundary per subject — tens of thousands of objects on a
real suite — and a report is a file people open, so the record keeps the names,
the counts and the subject lists, and a consumer that wants the graph recomputes
it from the snapshots. The echo list is capped at 100 and what the cap left out
is counted in the artifact, because a cap that says nothing reads as coverage.

## What this refuses to conclude

**An unexplained movement is not a flake.** It is a movement this run cannot
explain, which is a statement about the evidence the run assembled and not about
the subject. `variance run --flakes` is what settles one.

**Zero divergences is not "the components are deterministic".** It is "nothing
in this suite rendered two ways from one *props digest*, in the shapes the
exclusion of `children` could not explain". A component whose output depends on
something no subject varied is invisible here.

**An empty `created by` is not "nothing mounted it".** It is a production build,
where the owner links are gone. Every consumer of that field has to keep the two
apart, and the report's own types say so.

**Provenance is React's.** The boundaries come from the fiber tree, so a suite
built on anything else composes nothing at all — the raster tier's answer, with
the same honest absence. [Spec 0019](specs/0019-provenance-without-react.md) is
the vacancy.

**It has been measured on one application.** Fifteen stories, eight components,
one framework, one development build. `docs/comparison.md` already states the
neighbouring limit and it still stands: the cross-subject work has never seen a
real change set. Every number on this page comes from
[`examples/todomvc/src/composition.test.tsx`](../examples/todomvc/src/composition.test.tsx),
which is small enough that its measurements are assertions.

---

**Further:** [`flakiness.md`](flakiness.md#what-still-gets-through-and-how-it-is-found)
for what a second reading establishes and what it does not ·
[`history.md`](history.md) for the same questions across runs ·
[`packages/mcp`](../packages/mcp) for `variance_composition` ·
[ADR-0033](context/adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)
for why `created by` is recorded beside `within` ·
[ADR-0034](context/adr/0034-a-divergence-must-survive-the-children-it-excludes.md)
for the three refusals behind the zero.

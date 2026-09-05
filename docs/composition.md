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
- **What, in this run, explains each thing that moved.** An edited file, an updated
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

## Where a boundary is placed

Two relations run upward out of a rendered node and they are not the same
relation. **Parent** is what a node is *inside*: React's `return` chain, the
boxes it ended up in. **Owner** is what *rendered* it: the code that wrote the
element. A layout wrapper is the parent of everything handed to it and the owner
of none of it.

The walk in [`boundary.ts`](../packages/core/src/attribute/boundary.ts) uses both,
for different halves of one answer:

- **Parent decides nesting.** A boundary owns a contiguous region of the
  document, and what encloses that region is a fact about the tree. Reading the
  owner for this would produce a boundary set that is not a partition.
- **Owner decides membership and naming.** A component's own content is what
  *it* wrote. Content it was handed is a hole in its output — present, sized and
  positioned by it, authored somewhere else.

Boundaries are placed by owner, and by **every** level of the owner chain, not
just its head. Three components that return one another share one `div` and hold
three boundaries on it, so **a component that renders nothing but other
components is still a component**. Reading only `owners[0]` loses exactly the two
shapes a design system is made of: a variant wrapper (`DangerButton` returning a
`Button`) authors no host node and would be a boundary nowhere, and a container
would absorb its caller's content.

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
loses the caller, not the graph. Both rules degrade to naming everything, which
is the enclosure answer — coarser, never wrong in a new direction.

## What a boundary hashes

Inside a boundary, a child boundary is a placeholder, not its content.
Where the enclosing component placed the child, the placeholder names it; where
the child arrived as `children` from somewhere else, the placeholder is an
anonymous hole — a container is not told what it was handed, so its hash must not
depend on it.

That containment is the property the whole page rests on, so it is measured
against the whole suite rather than argued
([`closure.test.tsx`](../examples/todomvc/src/closure.test.tsx)):

| edit | components whose own content changes |
|---|---|
| padding on `.va-button` | `Button` |
| the corner-radius token | `Button`, `Card`, `Chip`, `TextField`, `Toggle` |

The first row is the claim a design system needs to be able to make about its own
change: one component changed, and **the eleven others did not** — including every
component that encloses a `Button` on every page in the suite. The second is the
same rule in the other direction: a foundation edit is *supposed* to cross
components, and the answer is the five that resolve through that token rather
than everything on a page containing one.

What the placeholder still carries is the *number* of children handed in, so a
caller passing three where it passed two changes the container. That residual
limit is stated in
[ADR-0035](context/adr/0035-a-node-stands-in-every-component-above-it.md).

### What the join key must not depend on

**Aliases are re-numbered per boundary.** The normalizer replaces every id with
`#a0`, `#a1`, … in document order across the whole *subject*
([ADR-0003](context/adr/0003-cruft-removal-and-css-applicability.md)). That is
right for a subject and fatal across two: the same field rendered in a story and
on a page gets `#a0` in one and `#a7` in the other, so their structure digests
differ for a reason that is an artefact of what else happened to be mounted.
[`instances.ts`](../packages/core/src/attribute/instances.ts) re-aliases to `#b0`,
`#b1`, … in the boundary's own document order. The association survives — a `for`
pointing at an input inside the boundary keeps pointing at it — while a reference
that escapes keeps its own slot and points at nothing in particular, because from
inside, one foreign target is indistinguishable from another.

**Geometry is left out of the joining digest.** A rect is absolute page
coordinates, so two identical renderings in two subjects disagree on it always.
The join key is the four content digests — structure, semantics, text, style —
and geometry is carried beside it, where a caller comparing two instances *within*
one subject can still read it. Framework wiring is excluded for the same reason
in the other direction: a component that gained a `memo()` renders the same
thing, and folding wiring in would make a performance annotation read as a visual
regression.

**Layout output is not style.** Under a profile with a layout engine the snapshot
carries resolved values, so a block element's computed `height` is whatever its
contents made it — and a button two levels down growing by six pixels changes the
computed height of every ancestor. These resolved layout properties belong to
`geometry`, so their changes do not produce a different style digest and
misidentify an ancestor as a cause. This includes `transform-origin`, whose
default resolved value follows the centre of the border box.

## The fold

`composeSubjects` walks the per-subject instance lists once, in plan order, and
buckets them: component → props class → rendering → sites. Every unattributed
boundary is skipped, and a boundary with no provenance is filed under a sentinel
not under `undefined`, so nothing downstream can read "unknown props" as
a props class like any other.

| level | key | why |
|---|---|---|
| component | name | the unit an edit changes |
| props class | props digest | the same inputs, or unknown |
| rendering | the four content digests | the same output |
| site | subject and path | the third `Chip`, which is a sentence |

It is pure and ordered: the report has to be a function of the plan, and a phase
that accumulated as a worker pool finished would produce a different artefact
from the same suite on a slower machine.

## What it answers

### Two examples watching the same bytes

An **echo** is one rendering digest with sites in more than one subject. Three
identical chips in one list say nothing; the same chip in a chip story and in a
page footer says that a reviewer looking at two diffs is looking at one. The
two-subject rule is the whole test — a rendering that survives being mounted
somewhere else is the one a second subject is watching.

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

A subject's **example** is its shallowest attributed boundary — the component the
subject exists to show — and only when it is alone at that depth. A story usually
mounts one thing; a page mounts a layout that mounts several, and calling the
first of them the subject's component would be picking a winner out of document
order.

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
full, and nobody would write a story for its internals. But it is a boundary with
a hash, five instances and five examples, so it can be *watched* without being
described, and an edit inside it resolves to the molecule that changed, not to
the whole page.

### One input, two renderings

A **divergence** is one props digest producing more than one rendering *at one
commit*. It is not a regression. It says the component's own inputs do not
determine its output, which is either a fact about the design — a token, a theme,
an ancestor's cascade — or a reading that is not repeatable. The bands say which
kind, in the same vocabulary a sensitivity absorbs, so a divergence entirely
inside a relaxed band can be dismissed without opening it.

Every rendering after the first also says **why**. Each is lifted out of the page
it was found in, re-rooted at the component, and read against the first for
[where the two parted](parting.md) — so the report does not stop at *`Price`
rendered two ways*, it says which input changed:

```text
Price (token) — 2 rendering(s) from one props digest
  2 subject(s): price, receipt
  1 subject(s): promo
    variation — an input changed and the page followed
    Price inherited a different `color` — an ancestor declared it
      2 deltas here (token) — color
```

The lift is what makes that readable. Compared as whole subjects, a receipt and a
promo card differ everywhere and the answer would be the difference the reader
already knows about. Compared as two `Price`s, they differ in one property.

This is the one place in the system a parting is reachable without a decision
about how both sides were read: both renderings come out of one run, off one
collector, at one commit, so they are read the same way by construction. It needs
no framework adapter either — the boundaries come from the owner chain and the
cascade from `styleProvenance` — which is why an ancestor's `color` is nameable
on a browser run.

**Measured on todomvc: zero.** A props digest is not a complete statement of a
component's inputs, so three shapes reach the check and are refused by it
([ADR-0034](context/adr/0034-a-divergence-must-survive-the-children-it-excludes.md)):

| shape | why it is not a divergence |
|---|---|
| Two boundaries of one component in one subject | Different nodes, not two renderings of one node |
| Different `children`, same props digest | The excluded field is the one that differs |
| Different rendered subtrees | Two sites that mount different components below them did not receive one input |

Each refusal is a check with a field behind it. Unknown props are not shared
props, so an instance whose provenance did not survive is never grouped with
another. A component whose nodes are interrupted by a nested boundary is walked
as two boundaries under one owner frame — one `TextField` becoming a label-shaped
rendering and an input-shaped one — so renderings that co-occur in a single
subject are one instance in two pieces, indistinguishable from two that genuinely
disagree. And `propsDigest` excludes `children` deliberately, so
`<Card><Stack/></Card>` and `<Card><Text/></Card>` share one; so two proxies for
"the children differed" are required to be quiet: the child components mounted,
and the boundary's own text.

The asymmetry is the reason those checks are code, not prose: a difference
wrongly dismissed as `contradicted` is an explanation nobody can act on, while
the same difference left unexplained lands on the suspect shortlist, where a
second reading settles it.

Zero is a real and common answer, and it means nothing in the suite renders two
ways from one input. `Card` keeps one props class and two renderings, which is the
honest residue: the count says the pair exists and the refusals say it is not
evidence.

### The subtree that recurs, at every depth

The join above is at one grain. `rendering` covers a component's own nodes with
its children named and never included, so a suite compared to itself answers
*which boundaries render the same* and nothing finer. A `<tbody>` of forty rows
that three pages render identically under three different components is three
renderings, because no boundary sits on it.

`nodeClosures(root)` hashes every node of a snapshot's tree over everything under
it, the way [`closureOf`](../packages/sense/src/tree.ts) hashes a file over its
input closure: bottom-up, so a subtree's digest is a function of its children's
digests and never of where the subtree sits. Two digests per node:

| digest | covers | agrees when |
|---|---|---|
| `structure` | the tag, and the children's structure digests | the same shape, whatever it says |
| `semantics` | the structure, and what the semantics band keeps for every node in it | the same shape saying the same thing |

An id contributes its presence and never its value, so an identical widget with
a different generated id is one digest. A reference — `for`, `aria-labelledby`,
an in-page `href` — is a fact about two nodes, and it enters at the lowest node
holding both, as the pair of paths relative to that node: a label naming the
input beside it reads the same on every page, and a label naming something
outside the subtree stays an unbound reference at every digest up to the one
that contains its target. Text enters `semantics`; style enters neither.

```ts
const shared = sharedClosures([
  { subject: 'inbox', root: inbox.root },
  { subject: 'archive', root: archive.root },
]);
// [{ tag: 'table', nodes: 41, semantics: 'held',
//    sites: [{ subject: 'archive', path: '…' }, { subject: 'inbox', path: '…' }], … }]
```

`sharedClosures` files every node of every subject by its structure digest and
reports the entries that recur in two or more subjects — the two-subject rule
again, at every depth at once. One rule keeps the list to what is worth reading:
an entry is reported only where its parent does not recur over exactly the same
places, which is the rule that makes an echo's example the shallowest boundary,
applied to every node. Two identical rows under one `<tbody>` are subsumed by
the body, the body by the table, up to the node that recurs on its own. Each
entry names the tag, the number of nodes beneath it, the sites by subject and
path, and whether `semantics` is **held** across the sites or **parted**: the
same shape saying different things, which is the divergence
[ADR-0034](context/adr/0034-a-divergence-must-survive-the-children-it-excludes.md)
permits, at a node no boundary claims. `floor` drops entries under a node count,
and where the floor sits is the report's to choose.

Neither digest enters a baseline or a join key. The component hash stays
own-with-holes so that an edit stays local
([ADR-0035](context/adr/0035-a-node-stands-in-every-component-above-it.md)); a
closure is computed by a run over what it already collected and compared within
that run.

### Why a component moved

For each changed component — named as a *cause* in a diff region or found to
differ between repeated readings — the run checks attribution rules in order
and stops at the first matching rule:

| rule | evidence | output |
|---|---|---|
| `edited` | a file declaring this component is in the change set | the file |
| `token` | a custom property *its own nodes* resolve through changed in this run | the tokens |
| `upstream` | a component that mounted it, or encloses it, was edited | the caller |
| `contradicted` | it renders two ways from one input at this commit | the divergence |
| `unexplained` | none of the above | the finding |

`edited` and `token` need [`--since`](selecting.md), and a run that did not ask
cannot reach either. That degrades honestly, and it is checked in
[`movement.ts`](../packages/core/src/attribute/movement.ts) rather than trusted
to the caller: an unexplained difference in a run with no change set carries a
sentence saying so instead of an accusation.

**The `upstream` rule checks `created by` before `within`.** The component that wrote the element is the one whose edit changed
this component's inputs. On todomvc, an edit to `src/app/todo.tsx` explains five
chip changes through `TodoFooter`; a run consulting only `within` finds `Stack`,
which nobody edited, and reports five unexplained differences instead of one
caller.

`token` is read off the component's own instances, not off the subject,
which is what makes it worth anything: every subject on a themed page resolves
through every token in the theme, so a subject-level intersection names them all
and explains nothing.

Two things ride beside every difference. **`alsoIn`** is the other subjects the
same component changed in this run — a reviewer reading eleven changed subjects
is often reading one edit, and the count is the difference between a frightening
report and an accurate one. **`held`** is the control group: sites of the same
component, with the same props, that this run did *not* report as changed. Empty
means there was no control, which weakens the finding, and is why it is a list
and not a flag.

Composition stops at an unexplained difference. How the run orders its shortlist
and turns a second reading into a verdict belongs to
[`flakiness.md`](flakiness.md#nothing-in-this-run-explains-it).

## What it costs

One pass over the instances every subject already reported, after the worker pool
and in plan order, so a slower machine that finishes subject 41 before subject 3
produces the same bytes. No browser, no image, no disk, no service. Every list
that reaches the artifact is sorted by code unit, not by locale, because a
report is committed, diffed and read back on another runner, and a locale-aware
comparison makes the byte order a promise about `LANG`.

What reaches the artifact is smaller than what produced it. The full graph
carries one entry per boundary per subject — tens of thousands of objects on a real suite
— and a report is a file people open, so the record keeps the names, the counts
and the subject lists, and a consumer that wants the graph recomputes it from the
snapshots. The echo list is capped at 100 and what the cap left out is counted in
the artifact, because a cap that says nothing reads as coverage.

## What this refuses to conclude

**It never decides anything.** Two subjects sharing a rendering is not a reason to
delete either: a component can be correct in one context and broken in the next,
which is why the contexts are separate subjects in the first place.

**An unexplained difference is not a flake.** It is a change this run cannot
explain, which is a statement about the evidence the run assembled and not about
the subject. `variance run --flakes` is what settles one.

**Zero divergences is not "the components are deterministic".** It is "nothing in
this suite rendered two ways from one *props digest*, in the shapes the exclusion
of `children` could not explain". A component whose output depends on something no
subject varied is invisible here.

**A props digest is one-way.** Two instances can be shown to have received
different props; *which* prop differed is not recoverable, and nothing here
pretends it is.

**An empty `created by` is not "nothing mounted it".** It is a production build,
where the owner links are gone. Every consumer of that field keeps the two apart,
and the report's own types say so.

**Provenance is React's.** The boundaries come from the fiber tree, so a suite
built on anything else composes nothing at all — the raster tier's answer, with
the same honest absence. A suite on another framework keeps its raster comparison
and gets no composition attribution.

**It is measured on one application.** Fifteen stories, twelve components, one
framework, one development build, one machine, and a change set declared by the
example rather than read from a repository's history. Every number is an
assertion in
[`composition.test.tsx`](../examples/todomvc/src/composition.test.tsx) and
[`closure.test.tsx`](../examples/todomvc/src/closure.test.tsx), which are small
enough that their measurements are the claim.

---

**Further:** [`instruments.md`](instruments.md) for where this axis sits among the
others ·
[`attribution.md`](attribution.md) for how a changed pixel arrives with a
component name on it ·
[`flakiness.md`](flakiness.md#nothing-in-this-run-explains-it) for
what an unexplained difference becomes ·
[`history.md`](history.md) for the same questions across runs ·
[`packages/mcp`](../packages/mcp) for `variance_composition` ·
[ADR-0033](context/adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)
for why `created by` is recorded beside `within` ·
[ADR-0035](context/adr/0035-a-node-stands-in-every-component-above-it.md)
for what a child boundary contributes to its container's hash.

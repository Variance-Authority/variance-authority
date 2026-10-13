# ADR-0027 — A baseline carries what its document said

**Status:** accepted
**Date:** 2026-08-05
**Extends:** ADR-0011 (durable and ephemeral retention), ADR-0018 (a component's hash covers its own nodes)
**Discharges:** spec 0017 (cause-first ranking on every path)

## Context

The strongest claim this project makes is that a changed pixel resolves to the
component that *caused* it rather than to the component that moved. It was true
of the differ and false of the binary, for an arithmetic reason rather than a
design one: a stored baseline is an image, an image carries no document, and
separating cause from collateral needs both revisions.

So `variance run` reported every region as collateral and ordered them by area —
the ordering [journal 0013](../journal/0013-observability.md) measured as
backwards by 6×, because **area measures displacement, not cause**. An edit that
reflows its surroundings moves far more of them than of itself.

Spec 0017 framed the choice as *carry* or *fetch*: grow the sidecar to hold the
previous document, or keep it in the shared cache and ask for it when ranking is
needed. It required the decision to be made before anything was built, which is
what this file is.

## Decision

**Carry, and carry the component hashes rather than the document.**

`Raster` gains `components?: readonly ComponentHash[]` — one line per component
boundary, structure, style and geometry digested separately (ADR-0018). It rides
in the sidecar beside a PNG that dominates it, so a baseline explains itself
wherever it is copied.

*Why carry rather than fetch.* Fetching makes the ordering of a report depend on
whether a cache was warm. This project's whole position is that the same inputs
produce the same answer, and a run whose report is ordered differently on a cold
machine is a run whose output is not a function of its inputs. A cache is allowed
to cost a render (ADR-0011 and `RenderCache`'s never-throw rule); it is not
allowed to change what the report says.

*Why hashes rather than the document.* A normalized document is the whole tree
with resolved styles; the hashes are one line per component. Ranking needs only
the question *which components' own content differs*, and `hashComponents` was
built to answer exactly that. Carrying the tree would make the sidecar a
compatibility surface an order of magnitude larger for no additional answer.

The comparison is `causesBetween`: a component whose `structure` or `style`
digest moved is a cause; a component whose only moved digest is `geometry` was
displaced and is not; a component present on one side only is a cause, along with
the parent whose own output changed to include or exclude it.

## Consequences

**Absent means unknown, never "no causes".** A baseline written before this
existed, a store that dropped the field, or a run with no snapshot yields
`Observation.causes === undefined` — and `rankRegions` falls back to area, which
is exactly what every run did before. An empty array would have been a confident
wrong answer: it says the run looked and found no cause.

**The parse is the one on a sidecar that degrades instead of refusing.** Every
other field decides a verdict — a missing identity cannot be partitioned, a
missing digest can never settle — so a malformed one is loud. This decides an
*ordering*, and failing a build over the field that makes a correct report
better-ordered would trade a working comparison for a tidy one.

**It found a defect in the hashes themselves, and the defect was invisible until
something consumed them.** `hashComponents` shipped in `core/attribute` and was
exercised only by its own unit tests. The first real consumer measured, on
`cases/storybook-case`, that **one padding edit inside `Button` named `Tokens`,
`Stack`, `Card` and the unattributed root as causes** — every component in every
affected story.

The cause is that under a profile with a layout engine the snapshot carries the
engine's *resolved* values, and some allowlisted properties are layout **output**
rather than authored input. `transform-origin` is the one nobody guesses: it
computes to half the border box, on every element, whether or not a transform is
declared — so it moves whenever the box does. `width` and `height` are the
obvious two and, measured, were not the ones doing the damage.

Those properties now hash into `geometry` rather than `style` under a profile
with layout, and stay in `style` under one without — where there are no computed
values, a declared `width: 100px` is the component's own content, and there is no
geometry digest to move it to. After the change the same case names `Button` and
nothing else.

**`(unattributed)` is never a cause.** It is the bucket for nodes whose
provenance chain broke, so it collects unrelated parts of a page under one name,
and no region could ever match it — a region with no owner reports no component.
A broken chain is a defect in this tool and is reported where that means
something, not smuggled into a culprit list.

**What is still not closed.** `observePair` — the ephemeral mode — carries a
single snapshot, so it has hashes for one side and cannot compare them. It stamps
what it renders, so a run that stores its output is already carrying them; the
comparison itself still needs a second snapshot the mode does not have. And
`tribunal`'s sidecar table has explicit columns, so a baseline stored there loses
the field and ranks by area until a migration adds it. Both degrade to the
previous behaviour rather than to a wrong one, which is the property the optional
field was chosen for.

**The join needed its own fix, and the reason was not the one assumed.** On the
day this landed, `cases/storybook-case` named `Button` as the cause and the
changed region still attributed to `Tokens` — which was read as the region's box
being inflated past the button's by antialiasing. Measuring it the next day said
otherwise: `Tokens` wraps `Button` and its rect is **byte-identical**
(`454.34,359 115.33×50`), because a block wrapper is exactly as big as its only
child. Neither box is tighter, so `attributeRegions` broke the tie in
`collectBoxes` order, which is pre-order, which is always the wrapper. Ties now go
to the innermost. The hashes and the join were two defects wearing one symptom,
and neither fix alone moved the report.

**And the measurement found a third thing, which is larger than both.** The image
that case has been comparing is 1024 CSS pixels wide where the acquired subject is
147.33 — `subject-size-diverged`, now reported as a `warn` on every affected
subject. Every coordinate this ADR's ranking is attached to is converted between
those two layouts. It happens to be exact on that story and will not be on a
centred one. See the checkpoint's open links; the fix is in acquisition, not here,
and it re-bases every stored image.

## Amended 2026-10-13 — a baseline carries its snapshot as well

The Decision above carried the hashes rather than the document because ranking
needed nothing more, and said the tree would add "no additional answer". The
region join is that answer. `attributeRegions` joined a changed region against
one snapshot's boxes, and a pixel comparison has two sides.

The default threshold moving from `0.1` to `0.01` (ADR-0026) showed the gap on
todomvc's broken toggle, which replaces a 16×16 checkbox with an 18×18 div two
pixels to its left. At `0.1` the threshold forgave the antialiased edge where
the two overlap, and what was left fitted inside one box. At `0.01` the region
is 20×18. 71% of it is inside the input that left and 88.75% inside the div that
arrived. Both are under the 0.9 containment, so the region named `Stack`, the
row around both. At `0.1` it named `Toggle` only because half the edit was
forgiven.

**Each node is joined against the union of its own box and its counterpart's in
the baseline, and the differ's matcher says which node is its counterpart.**
The union is of the two boxes as places, not the rectangle that holds both: a
node that moved across a row was never in the space between.
`AttributionOptions.before` is the snapshot of the revision the pixels are
compared against. It is required, and `undefined` is an answer. `matchTrees`
already pairs nodes by content and identity, so a path renumbered by a sibling
inserted ahead still pairs. It now pairs one more case: under one matched
parent, exactly one element left and exactly one arrived, and the same
component's `createdBy` wrote both. That rests on recorded authorship, not on a
spelling. Two such pairs under one parent stay unpaired, because either could be
either. So do two nodes that each declare who they are, by an alias or a role
and name: `createdBy` names a component, not a slot, and every `<Button>` is
created by `Button`, so a Save button and an Export link share an author while
their names say they are two elements. The pair is diffed like any other and leads with a `tag-changed` delta
(geometry, structural), so a replacement never reads as a small edit: on the
broken toggle the docket's `Toggle` root moves from 6 geometry deltas (three
removed, three added) to 97 across geometry, a11y and token, and its band from
`geometry` to `a11y`, because the checkbox role is gone. No reader took a
removed node and an added one as a signal of their own. The docket counts
`tag-changed` as structural, as it counts both of those, and `parting` files a
delta under the boundary that owns its path, which for a pair under one matched
parent is the same boundary. `tag-changed` is said of every pair across two tags,
so a `<button>` and a `<div role="button">` that one role and name joined, which
before reported nothing for the tag, now report it.

The hashes could not carry this. They keep one box per instance root, and the
replaced element is not an instance root; nothing in them is a node the matcher
can pair.

**The snapshot rides in the sidecar, packed.** `Raster.snapshot` is gzipped JSON
in base64, a `PackedSnapshot`. Measured with every baseline written by this
change:

| | tree as JSON | packed | component hashes |
| --- | --- | --- | --- |
| todomvc, populated list | 163,032 B | 8,211 B | 11,402 B |
| `cases/storybook-case`, 13 baselines | 372,612 B | 49,528 B (3,220–5,392 B each) | 52,328 B |

On the Storybook case the packed tree adds 54% to sidecars that were 91,647 B
without it. Nothing the matcher reads was trimmed. Every store carries the field
as text and never opens it: the durable store and the render cache through
`sidecarFrom`, the remote store the same way, and tribunal in a `snapshot`
column on `baselines` and a `candidate_snapshot` column on `build_subjects`
(schema 21), so an approval promotes it. `describe` does not return it, since
a subject that settles on its document digest builds no comparison and joins
nothing. It says only whether the baseline kept one, as `keepsSnapshot`,
because that decides whether the subject may settle (below). The render cache
holds pixels and keeps no tree: a cache hit carries this run's evidence or
none, as it does for component hashes.

*Why the ends live in `observe`.* `packSnapshot` and `unpackSnapshot` are there,
not in `raster`. Packing needs `node:zlib`. `raster` is portable, and tribunal's
Worker runs without `nodejs_compat`, so neither may import it. Every producer of
a baseline (the Playwright fixture and its promotion, the Vitest browser
provider, the CLI's image sidecars) and the one consumer, `decide`, already
depend on `observe`.

*Why this is not the compatibility surface the Decision feared.* No store parses
the tree, so no store refuses a sidecar over it. `unpackSnapshot` checks the
format version and, with `isSemanticSnapshot`, every node down to the leaves,
and a snapshot it cannot read is treated as not recorded, exactly like a missing
one.

**A baseline without a snapshot says so.** One accepted before this field is
joined against the changed render's boxes alone, and the changed verdict's
sentence ends `the baseline records no snapshot of its nodes, so regions were
joined against this render's boxes alone: an accepting run records one on a
revision where this subject is unchanged`. When the before side is an image
handed in, the sentence names the image and gives no remedy, because no accept
rewrites it. Without the clause, the row the region fell to would read as the
answer.

**An accepting run re-stamps an unchanged baseline that kept no snapshot.** The
clause appears only on a changed verdict, and accepting that verdict accepts the
change with it. An unchanged subject was never rewritten, so without the
re-stamp a baseline would keep no snapshot until the change it was needed for.
The observation marks such a subject `signals.snapshot: 'unrecorded'` whenever
this run collected a snapshot and the stored baseline kept none that unpacks.
An image handed in is never marked, since nothing stores it. `restamps` in
`@variance-authority/core/judge` adopts the mark beside an identity that moved
(ADR-0090), and `--update-snapshots`, Vitest's `--update` and `variance accept`
all ask it.

A subject whose document has not moved settles on its digest and builds no
observation, so nothing would mark it. `settle` therefore renders a pictured
baseline whose `keepsSnapshot` is `false` when this run has a snapshot to
record, as it renders one painted under another identity. The cost is one
render for each such subject on every run until an accepting run re-stamps it,
or under tribunal on one run, whose push records it (below): a suite of
baselines accepted before this field renders in full until then. A baseline with no
pixels still settles, because no region is joined there. A run that collects
no snapshot settles as before, because it would have none to record.

**Tribunal records it on the push.** Approval is asked of a changed subject, so
under tribunal no reviewer would ever record an unchanged one's snapshot, and a
project that moves baselines only by approval would render each such subject on
every run. So ingesting a build writes a candidate's snapshot onto the baseline
an approval would overwrite, when that baseline has an image, kept no snapshot
`keepsSnapshot` reads, and was painted from the candidate's document under the
candidate's identity: the premise `settle` skips a render on, whatever verdict
the run reported. A snapshot it kept is never replaced, and the image, the
digest and the time stay as they were. From the next run under that identity
the subject settles. A `remote` store served by tribunal reads the same table.
Every other store records it on its next accepting run, as above.

*What such a snapshot describes.* The document digest covers what is painted,
not the runtime that produced it: no file path enters it, so a component renamed
without changing its output keeps the digest. The fields read off the page
(tags, roles, names, text, attributes, styles, boxes) are the ones that painted
the image. The fields read off the runtime (`provenance`, `createdBy` with it,
`wiring`, `holding`, `styleProvenance`, `styleTokens`, `ignoredBy`) are the
recording run's: a run that drew the same document, not necessarily the one that
painted the image. On a baseline an accepting run re-stamps it is that run; on
one tribunal records it is the first push, from a build on any branch, that drew
the document after the baseline kept none, and no later push replaces it.
Tribunal's baselines have no branch, as an approval of a branch's build moves
them already, so those fields can name files of code that never merged. At the
subject's next change, the join pairs against the authors of the code that
recorded it.

**What is still not closed.**

- `observePair` renders two documents and is given one snapshot, the after
  side's. Its before side never has a snapshot, so every changed verdict it
  attributes carries the clause until the mode is given the second snapshot the
  open work above already asks for.
- A node that left with nothing paired to it adds no box. A region over the
  place it vacated falls to the parent around it, which did change its output.
- A store other than tribunal records an unchanged subject's snapshot only on
  an accepting run. Until one, each such subject renders on every run.
- tribunal stores a snapshot whose text carries the header but will not unpack,
  by approval or on the push, as kept. No push or settle replaces it, only
  approving the subject's next change. That change's reason says its baseline
  records none, and names as the remedy an accepting run on a revision where the
  subject is unchanged, which settles it on its digest and records nothing.
- Ignored subtrees are masked by their boxes in this render alone
  (`excludedBoxes` in `decide`). An ignored element that moved or shrank leaves
  pixels at its old box unmasked, and the baseline's snapshot now holds that
  box; joining it is a change of the ignore's rule, not of attribution.
- The packed bytes are deterministic for one zlib, not across zlib versions. No
  digest covers them, so a re-accept on another machine can only rewrite the
  field, never move a verdict.

The in-place Playwright path shoots both images from one snapshot and passes
that snapshot as both sides, which is exact.

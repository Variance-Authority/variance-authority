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

# From a pixel to a line

A pixel differ answers one question — how many pixels moved — and *5482* is not a
finding. It cannot be read, it cannot be assigned, and the only available
response to it is to open the image and look, which is the expensive act the tool
was supposed to replace.

Attribution is the chain that turns that number into a sentence: **this region,
inside `Toggle`, in `main → region "Todos" → item 2 of 3`, written at
`examples/todomvc/src/ds/components.tsx:107`.** Five hops, each one a pure function over data the run
already holds, and each one able to fail in a way the next hop can see.

| hop | from | to | where |
|---|---|---|---|
| isolate | a change mask | regions with boxes | [`mask.ts`](../packages/core/src/attribute/mask.ts) |
| join | regions and a snapshot | a node per region | [`region.ts`](../packages/core/src/attribute/region.ts) |
| name | a node's provenance | a component | [`provenance.ts`](../packages/core/src/format/provenance.ts) |
| orient | a node's path | a landmark phrase | [`locate.ts`](../packages/core/src/attribute/locate.ts) |
| locate | a fiber's evidence | `file:line` | [`call-site.ts`](../packages/core/src/attribute/call-site.ts), [`source.ts`](../packages/core/src/attribute/source.ts) |

The split is not tidiness. The first hop is arithmetic on a bitmask and can be
tested with a hand-written mask; the second needs a snapshot and no browser; the
last needs a source map and a fetch. They fail differently, so they are separated
where they fail.

Causality runs one way through all of it — code to semantic to raster — and the
system never infers cause from pixels. Every serialized node already remembers
which components produced it, so by the time a change is observed its author is
*known* rather than reconstructed.

## Where on the canvas

A change arrives as a mask: one byte per pixel, row-major, `1` where the pixel
differs, with the changed count carried so nothing has to rescan. A mask rather
than a diff image, because an image is for looking at and everything downstream
wants to compute.

`isolateRegions` clusters it. Connected components are computed on a coarse grid
— **8 pixels by default** — rather than on the pixels themselves, which is a
performance decision and a semantic one at once. The coarse pass is one linear
sweep instead of a merge over thousands of glyph-edge fragments, and it produces
the grouping a reader would have produced by eye: at cell 1 a paragraph of
restyled text is four hundred regions, which is the same unreadable output as a
single number, only longer. At cell 8, a word is one region and a button is one
region.

Membership is decided coarsely and **coordinates are not**: bounding boxes are
tightened back onto the actual changed pixels afterwards, so a region's box is
exact. Each region carries its pixel count and its density — `pixels / area` —
which is what tells a scattered text change from a solid block of repaint.

Regions come back largest first, capped at 32, and the cap is *reported*:
`truncated` counts the regions dropped and `truncatedPixels` the change in them.
A capped list that does not say it was capped reads as complete coverage, and the
reader has no way to know the difference.

## What is there

`attributeRegions` joins those coordinates to the box tree. It needs a snapshot
carrying rects, so it needs a profile with a layout engine
([ADR-0002](context/adr/0002-observation-profiles.md)); under a profile without
one every region comes back unattributed, which is the correct answer — a rect
that was never observed must never be inferred.

Three numbers decide the join:

- **`scale`, which the caller must state.** Device pixels are not CSS pixels, and
  a raster taken at `deviceScaleFactor: 2` is twice the size of the rects in the
  snapshot. There is no default, because the failure mode of a wrong scale does
  not look like a failure: every region lands in the top-left quadrant, every one
  of them attributes to *something*, and the report comes out full, plausible and
  about the wrong components. Making the caller state it turns that into a
  decision somebody made.
- **`origin`**, the page-space CSS corner of the raster. It defaults to the
  subject root's own rect, which is right when the screenshot was clipped to the
  subject; a full-page shot passes `{x: 0, y: 0}`.
- **`containment`, 0.9.** The fraction of a region's area that has to fall inside
  a box to count as inside. Below 1 because a region's bounding box is inflated
  by antialiasing at its edges, so exact containment would reject the correct
  node on a text change. It is the one genuinely fuzzy number in the chain, and
  it is named rather than buried.

The answer is the **tightest** containing box, not the topmost: a change inside a
button is also inside the card and inside `<main>`, and only the innermost answer
is actionable.

**Ties go to the innermost box, and that is one component name in every report
over a design system.** A wrapper that shrink-wraps its only child carries a
byte-identical rect — measured on [`cases/storybook-case`](../cases/storybook-case),
where `Tokens` and `Button` are both `454.34,359 115.33×50`. Neither is tighter,
so the walk decides, and since boxes are collected in document order a strict
comparison keeps whichever came first, which is always the *outer* one. The run
would then name a wrapper nothing edited and send a reviewer to its file. The
comparison is `<=`, so the last equal box wins: the innermost, which is also the
one the browser painted on top.

### When nothing contains it

A region no box contains is reported `unattributed`, and this is rarer than it
first looks. A screenshot clipped to the subject means the root's box contains
every pixel in it, so paint escaping a button still falls inside the card — and
attributing it to the card is correct, not a consolation prize.

What the flag actually catches is a region that fell outside the tree entirely,
and the overwhelmingly likely cause is a wrong `scale` or `origin`. It is worth a
loud signal precisely because it does not look like one.

`nearest` is offered beside it: the tightest node the region *overlaps*, present
only when unattributed. It is orientation — "what is this near" — and it lives in
its own field because that is a different claim from "this is what changed", and
keeping both in one field is how the second gets asserted with the confidence of
the first. Nothing promotes it.

## Which component

A node's provenance carries two upward relations and they are not the same
relation.

| field | means |
|---|---|
| `createdBy` | the component whose JSX literally created this element |
| `owners[0]` | the nearest *enclosing* composite component |

They diverge exactly where an element is passed as a prop:
`<Card title={<h3>Invoice</h3>} />` gives the `<h3>` `createdBy: Page` and
`owners[0]: Card`. Attribution needs the author, so `component` is `createdBy`
falling back to the enclosure. The enclosure is carried separately as `owner`,
and only when it says something the author does not — an `owner` repeating the
author is noise in every report that prints it.

Carrying both is what lets ranking match a cause list without guessing which
namespace it is written in. A component *hash* is named for the enclosure
([ADR-0018](context/adr/0018-a-component-hash-covers-its-own-nodes.md)) while a
region is named for its author, and matching one against the other does not fail
loudly — it silently finds nothing, and the ordering falls back to area, which is
the thing the cause list exists to prevent.

`createdBy` is a development-build artefact. In production React's owner links
are gone, and absent degrades to the enclosure: coarser, never wrong in a new
direction.

## Where, in words

A path like `0/0/0/2/1/0` is an address, not a location, and coordinates are
worse — a rect moves whenever anything above it reflows, so "at (412, 880)"
describes this build and no other.

`locate` builds a phrase from the things a person would use to say where they
are: the landmark they are in, the named region or dialog, and their position in
a list. `main → region "Todos" → list → item 2 of 3` is a sentence somebody can
follow without opening a screenshot, and it stays true while the layout moves
under it. A path that does not resolve produces an empty location rather than an
exception; losing the phrase is not worth losing the finding.

## Which line

Naming a component is one step short. An agent asked to fix `Button` still has to
find `Button`, and a reviewer still has to guess whether it is the design-system
one or the local one in checkout.

There are two kinds of answer here and they are not interchangeable. Resolving a
component name against a source index names where the component is **declared**.
A call site names where the element that changed is **written**, which for
anything rendered more than once is the only one of the two that distinguishes
the instances.

### What each build already knows

| | automatic transform | classic transform |
|---|---|---|
| **React 19** | `_debugStack` | `_debugStack` |
| **React 18** | `_debugSource` | nothing — install [`packages/jsx-source`](../packages/jsx-source) |
| **production** | nothing — install [`packages/jsx-source`](../packages/jsx-source) | same |

React 19 constructs an `Error` inside its own element factory and keeps it on
every fiber, so a call site is present in any development build — every dev
server, every Vitest run, every Jest run, with nothing installed and no
`jsxImportSource` spent. React 18 kept the transform's own `{fileName,
lineNumber, columnNumber}` as `_debugSource`, which is cheaper still because
nothing has to be resolved.

Where `@variance-authority/jsx-source` is installed it wins, because it is exact
without a map, and it survives minification — so it is the answer for a built
Storybook or a statically served bundle, where no capture exists at all.

### Spending a stack

A stack frame names the module the browser was *served*; the file a reviewer
opens is a source map away. Both halves are written out rather than installed,
because `core` has no third-party dependencies
([ADR-0013](context/adr/0013-packages-are-named-for-their-requirements.md)).

Parsing a stack is a fact about a JavaScript engine — V8's `at App (url:23:26)`
and SpiderMonkey's `App@url:23:26` both, with unreadable lines dropped rather
than raised, since a stack is diagnostic output and a frame nobody can read is
one fewer candidate.

Choosing *which* frame is the author is a policy, and it has a defensible rule
rather than a heuristic: **the first frame that resolves to a file the project
wrote.** Frame zero is always React, because React constructed the error. Frame
one is the author in an ordinary build and a custom JSX runtime in a build that
has one — and nothing needs to know which, because Emotion resolves into
`node_modules` and the component does not. An application module with *no* map is
not a vendor frame: a dev server serves plain `.js` as written, so the frame's own
coordinates are already the answer.

**The economics are what make this worth doing rather than clever.** Measured on
a 4211-node document: every fiber carried a stack, and between them they held
**14 distinct call sites**. A hundred-row table writes two thousand cells from
one line of JSX. The work is per call site, not per node, and the cache is not an
optimization but the thing that makes the cost bounded — a handful of module
fetches for a whole page.

It is also asked on a signal rather than on every capture. Frames ride the
snapshot as provenance and no hash projects provenance, so `locateSites` spends
them for the handful of nodes a report is about to name. A page whose only change
is one button resolves one call site; a page that did not change resolves none.
The frames are transient by design and never reach a document, a digest or a
baseline: a frame holds an absolute URL with a build hash in it, and hashing one
would make every baseline disagree with the next dev-server restart.

The fetch itself is injected. `core` may not assume a network, and the right way
to fetch differs by caller — a browser-driving collector should fetch from the
page's own context, where the origin, the cookies and the dev server's module
graph are already correct.

### The fallback nobody configures

`indexSource` reads a file and returns component name → where it is declared,
recognised as a function, a `const`, a class or a declaration, with *how* it was
recognised carried so a bad match is debuggable. It is what a repository that has
configured nothing still gets, and it answers with a declaration, which is
coarser than a call site and enough to open the right file.

A name may map to several files, and that is not an error to be resolved by
picking one. Two components genuinely can share a name, and silently choosing the
first would send an agent to edit the wrong file with full confidence. Ambiguity
is reported ([ADR-0003](context/adr/0003-cruft-removal-and-css-applicability.md)'s
rule for overlapping projections, applied to source).

## Ranking, and why area is the wrong order

`rankRegions` exists because of a measurement, and it is the most useful thing
the raster tier has produced. Replacing a checkbox with a styled div on the
todomvc corpus changes 1530 pixels in 5 regions, which attribute geometrically
and rank by area as:

```
  933px  Text      <- changed, and reflowed
  511px  Stack     <- only reflowed
   86px  Toggle    <- the edit
```

Every one of those attributions is correct — the pixels really are inside those
nodes. The *ordering* is wrong, because **area measures displacement, not
cause**. An edit that reflows its surroundings moves far more of them than of
itself, so `Stack`, which nothing edited, outranks `Toggle`, which is the edit.

Geometry cannot fix this; it has no access to why. The semantic tier does — it
has provenance and props digests — so the raster tier stops claiming to rank and
takes the ordering from the tier that can, promoting `Toggle` above `Stack` while
leaving every attribution untouched. A region matches a cause under either
namespace, author or enclosure, because a one-sided test finds nothing and
silently reverts to area.

Two limits, stated rather than smoothed over. The semantic tier may name more
than one cause and on that case it names two, `Toggle` and `Text`, both real —
this does not collapse them, because picking one would be inventing a fact. And
with no causes supplied the order falls back to area, which is honest and is not
good.

## What this refuses to conclude

**A region no box contains is not attributed to the nearest one.** Painting
escapes its box routinely — shadows, outlines, overflowing glyphs — and a system
that resolved those by picking the nearest node would produce confident
attributions of exactly the kind an agent then acts on.

**A rect that was never observed is never inferred.** Without a layout engine
there is no geometry, so there is no join, and every region says so.

**A component name is not a file.** It is resolved against an index built by
reading source, and where two files declare the name, both are reported.

**A `file:line` is not a cause.** It is where the element that occupies a changed
region is written. What *caused* the movement is a different question, answered
by [`composition.md`](composition.md)'s ladder from the change set, the tokens
and the callers.

**The line comes from the build, not from the pixels.** Where no transform, no
fiber error and no source map is available, the answer is a declaration or
nothing — and nothing is printed as nothing.

---

**Further:** [`composition.md`](composition.md) for what explains a movement once
it has a name · [`source.md`](source.md) for the other direction, from a diff to
the subjects it could have reached ·
[`packages/jsx-source`](../packages/jsx-source) for the exact locations ·
[`packages/react`](../packages/react) for what the fiber gives up ·
[ADR-0007](context/adr/0007-subject-boundary-is-the-component-tree.md) for the
subject boundary ·
[ADR-0033](context/adr/0033-the-component-that-mounted-it-is-not-the-one-it-sits-in.md)
for why the enclosure is recorded beside the author.

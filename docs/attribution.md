# From a pixel to a line

**[Variance Authority](README.md)** is a visual regression system you run yourself: it
renders a UI state, compares it against the baseline you approved, and reports
what changed in the vocabulary of your source — the component that drew the
pixels and the `file:line` it was written at.

Attribution is the part that produces that second half. A pixel differ answers
one question — how many pixels differ — and *5482* cannot be read, cannot be
assigned, and leaves you opening the image to look, which is the expensive act
the tool was supposed to replace. Attribution turns the count into **this
region, inside `Toggle`, in `main → region "Todos" → item 2 of 3`, written at
`examples/todomvc/src/ds/components.tsx:107`.**

Read this page to find out how a changed region gets a component name and a
`file:line`, what each step needs from your build, and where the chain stops
instead of guessing. New here? Start with [your first run](start.md).

Five hops, each one a pure function over data the run already holds.

| hop | from | to | needs |
|---|---|---|---|
| isolate | a change mask | regions with boxes | nothing but the mask |
| join | regions and a snapshot | a node per region | a snapshot carrying rects |
| name | a node's provenance | a component | React's owner links, which a development build keeps |
| orient | a node's path | a landmark phrase | landmarks, roles and list position in the snapshot |
| locate | a fiber's evidence | `file:line` | a call site on the fiber, and a source map fetch |

A hop whose input is missing reports that it is missing; the hops before it
still answer. A run with no layout engine reports every region `unattributed`,
and a build that carries no call site still names the component.

Causality runs one way through all of it — code to semantic to raster — and the
system never infers cause from pixels. Every serialized node already remembers
which components produced it, so by the time a change is observed its author is
*known* rather than reconstructed.

## Where on the canvas

A change arrives as a mask: one byte per pixel, row-major, `1` where the pixel
differs, with the changed count carried so nothing has to rescan.

`isolateRegions` clusters it. Connected components are computed on a coarse grid
— **8 pixels by default** — rather than on the pixels themselves, and the grid
size decides whether the output is readable. At cell 1 a paragraph of restyled
text comes back as four hundred regions, which is as unreadable as a single
number and longer. At cell 8, a word is one region and a button is one region.

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
carrying rects, so it needs a **profile** — the named capture setup a run
records under — that has a layout engine. `jsdom` has none; `chromium` does.
Under a profile without one every region comes back unattributed: a rect that
was never observed is never inferred.

Three numbers decide the join:

- **`scale`, which the caller must state.** Device pixels are not CSS pixels, and
  a raster taken at `deviceScaleFactor: 2` is twice the size of the rects in the
  snapshot. There is no default, because the failure mode of a wrong scale does
  not look like a failure: every region lands in the top-left quadrant, every one
  of them attributes to *something*, and the report comes out full, plausible
  and about the wrong components.
- **`origin`**, the page-space CSS corner of the raster. It defaults to the root
  rect of the **subject** — one named UI state you asked for and can ask for
  again, identified by a stable id like `story:checkout--empty` — which is right
  when the screenshot was clipped to that subject; a full-page shot passes
  `{x: 0, y: 0}`.
- **`containment`, 0.9.** The fraction of a region's area that has to fall inside
  a box to count as inside. Below 1 because a region's bounding box is inflated
  by antialiasing at its edges, so exact containment would reject the correct
  node on a text change.

The answer is the **tightest** containing box, not the topmost: a change inside a
button is also inside the card and inside `<main>`, and only the innermost answer
is actionable.

**Ties go to the innermost box, and that is one component name in every report
over a design system.** A wrapper that shrink-wraps its only child carries a
byte-identical rect: a `Tokens` wrapper and the `Button` inside it both measure
`454.34,359 115.33×50`, and neither is tighter. The tie is broken toward the
innermost box — the one the browser painted on top, and the one somebody edited
— so a report over a design system names the component and not the wrapper
around it.

### When nothing contains it

A region no box contains is reported `unattributed`, and this is rarer than it
first looks. A screenshot clipped to the subject means the root's box contains
every pixel in it, so paint escaping a button still falls inside the card — and
attributing it to the card is correct, not a consolation prize.

What the flag actually catches is a region that fell outside the tree entirely,
and the overwhelmingly likely cause is a wrong `scale` or `origin`. It is worth a
loud signal precisely because it does not look like one.

`nearest` is offered beside it: the tightest node the region *overlaps*, present
only when unattributed. It answers "what is this near", which is a different
claim from "this is what changed", so it is a separate field. Nothing promotes
it into the attribution.

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

Both are carried because the two names are written in different places: a
component hash is named for the enclosure and a region for its author, so
anything matching one against the other has to try both.

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
component name against a [source index](source-index.md) names where the
component is **declared**.
A call site names where the element that changed is **written**, which for
anything rendered more than once is the only one of the two that distinguishes
the instances.

### What each build already knows

Do not instrument a development build by default. React already supplies the
exact call site in every common development configuration.

| Subject build | Call-site source | Build change |
|---|---|---|
| **React 19 development**, automatic or classic JSX | `_debugStack` | none |
| **React 18 development**, automatic JSX | `_debugSource` | none |
| **React 18 development**, classic `createElement` output | none | switch to automatic development JSX and add [`@variance-authority/jsx-source`](https://variance-authority.dev/reference/packages/jsx-source), when exact lines are required |
| **production React artifact** | none | automatic development JSX plus [`@variance-authority/jsx-source`](https://variance-authority.dev/reference/packages/jsx-source), when exact lines are required |

React 19 constructs an `Error` inside its own element factory and keeps it on
every fiber, so a call site is present in any development build — every dev
server, every Vitest run, every Jest run, with nothing installed and no
`jsxImportSource` spent. React 18 kept the transform's own `{fileName,
lineNumber, columnNumber}` as `_debugSource`, which is cheaper still because
nothing has to be resolved.

`@variance-authority/jsx-source` is optional production-build instrumentation,
installed only when one of the last two rows applies:

```bash
npm install --save-dev @variance-authority/jsx-source
```

It preserves the compiler's exact location without a map and survives
minification, so a built Storybook or statically served bundle can distinguish
several instances of one component. Without it, observation and attribution
still run; the report falls back to the component declaration where one can be
resolved.

### Spending a stack

A stack frame names the module the browser was *served*; the file a reviewer
opens is a source map away.

Stack syntax is an engine fact, so both spellings are read — V8's
`at App (url:23:26)` and SpiderMonkey's `App@url:23:26` — and a line neither
matches is dropped rather than raised. A stack is diagnostic output, and a frame
nobody can parse is one fewer candidate.

Choosing *which* frame is the author is a policy, and it has a defensible rule
rather than a heuristic: **the first frame that resolves to a file the project
wrote.** Frame zero is always React, because React constructed the error. Frame
one is the author in an ordinary build and a custom JSX runtime in a build that
has one — and nothing needs to know which, because Emotion resolves into
`node_modules` and the component does not. An application module with *no* map is
not a vendor frame, but it is not an answer either: a position in the text a
server sent is a position in the repository only if a map says so, so a served
frame with no map is refused. A frame that names a file on disk is kept as it
stands, because a Node runner applies maps to `Error.stack` itself and its
coordinates arrive already original.

The work is per call site, not per node, which is why a whole page costs a
handful of module fetches. Measured on a 4211-node document: every fiber carried
a stack, and between them they held **14 distinct call sites**. A hundred-row
table writes two thousand cells from one line of JSX.

Call sites are resolved for the handful of nodes a report is about to name, not
on every capture. Frames ride the snapshot as provenance and no hash projects
provenance, so `locateSites` spends them only there. A page whose only change is
one button resolves one call site; a page that did not change resolves none.
The frames are transient by design and never reach a document, a digest or a
baseline: a frame holds an absolute URL with a build hash in it, and hashing one
would make every baseline disagree with the next dev-server restart.

The fetch is supplied by the caller, because the right way to fetch differs by
host. A browser-driving **collector** — the module that reaches your UI and
hands each subject to the run — should fetch from the page's own context, where
the origin, the cookies and the dev server's module graph are already correct.

### Asking the engine

A call site says who *wrote* an element. The other question a report needs
answered is where the component that rendered it is *declared*, and the scan
below answers it by name: every declaration in the configured directories that
spells `Button`, ambiguous when two do. The page holds something better than a
name. The fiber carries the function React called, and the engine knows where
every function it compiled begins — V8 exposes it as `[[FunctionLocation]]`, a
script and a position, read over the debugger protocol.

So the page agent keeps every component function provenance names, held by
identity and never serialized, and the collector asks Chromium about each one
after a subject is read. The position is in the served module, which is the
same coordinate a stack frame carries, so it goes through the same maps and the
same vendor rule as a call site. What comes back is a source index whose refs
say `via: 'engine'`, and it is laid over the scan rather than merged with it: a
name the engine located replaces the scan's candidates for it, and a name the
engine never met keeps them. That is what turns an ambiguous name into one
file, because the engine can only speak for a component that rendered, which is
exactly the one the report is about.

The engine's answer reaches the run's own `source` and the composed report's
`files` field, and `@variance-authority/playwright-test` lays it over the
`source` an observation was given. Chromium only: the property is V8's, and on
another engine the reader answers nothing and the scan stands as it did.

### The fallback nobody configures

`indexSource` reads a file and returns component name → where it is declared,
recognised as a function, a `const`, a class or a declaration, with *how* it was
recognised carried so a bad match is debuggable. It is what a repository that has
configured nothing still gets, and it answers with a declaration, which is
coarser than a call site and enough to open the right file.

A name may map to several files, and that is not an error to be resolved by
picking one. Two components genuinely can share a name, and silently choosing the
first would send an agent to edit the wrong file with full confidence. Ambiguity
is reported instead.

## Ranking, and why area is the wrong order

`rankRegions` exists because of a measurement. A **tier** is a level of
observation: the structure-and-style reading of a document, which any DOM host
produces, and the painted image, which only a browser can. Replacing a checkbox
with a styled div on the todomvc corpus changes 1530 pixels in 5 regions, which
attribute geometrically and rank by area as:

```
  933px  Text      <- changed, and reflowed
  511px  Stack     <- only reflowed
   86px  Toggle    <- the edit
```

Every one of those attributions is correct — the pixels really are inside those
nodes. The *ordering* is wrong, because **area measures displacement, not
cause**. An edit that reflows its surroundings displaces far more of them than of
itself, so `Stack`, which nothing edited, outranks `Toggle`, which is the edit.

Geometry cannot fix this; it has no access to why. The semantic tier does — it
has provenance and props digests — so the raster tier stops claiming to rank and
takes the ordering from the tier that can, promoting `Toggle` above `Stack` while
leaving every attribution untouched. A region matches a cause under either
namespace, author or enclosure, because a one-sided test finds nothing and
silently reverts to area.

Two limits. The semantic tier may name more than one cause, and here it names
two: `Toggle` and `Text`, both real. It does not collapse them, because picking
one would be inventing a fact. With no causes supplied the order falls back to
area.

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
by [the ladder from the change set, the tokens and the
callers](composition.md).

**The line comes from the build, not from the pixels.** Where no transform, no
fiber error and no source map is available, the answer is a declaration or
nothing — and nothing is printed as nothing.

---

**Further:** [what explains a change once it has a name](composition.md) ·
[the other direction, from a diff to the subjects it could have
reached](source.md) ·
[`@variance-authority/jsx-source`](https://variance-authority.dev/reference/packages/jsx-source)
for optional production call-site instrumentation ·
[`@variance-authority/react`](https://variance-authority.dev/reference/packages/react)
for what the fiber gives up · [the subject boundary, and why the enclosure is
recorded beside the author](framework.md).

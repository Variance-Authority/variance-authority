# 0013 — Making it observable: phases, two retention modes, and what area gets wrong

**Branch:** B10 — raster tier
**Steer:**

> *"Time to make it 'observable'. Two modes: durable and ephemeral … Can get
> HTML/DOM from jsdom and send to render, or can get from playwright and sent to
> server, or get from playwright and use it to render image. Compare: pixelmatch?
> Isolate diffs: Map to code: MCP tools. All separate files/phases. Composable
> and testable."*

## What was built

Six phases, one module each, because each fails differently and each has to be
exercisable without the others.

| phase | in | out | needs |
|---|---|---|---|
| acquire | live DOM | `RenderDocument` | a DOM |
| assemble | `RenderDocument` | HTML | nothing |
| render | HTML | `Raster` | a browser, here or over a socket |
| compare | two `Raster` | `ChangeMask` | PNG decoding |
| isolate | `ChangeMask` | regions | nothing |
| attribute | regions + snapshot | components | nothing |

Two of six need a browser and two need nothing at all. The steps that decide
*what a change means* are pure functions over plain data — which is why the
questions worth asking about them are cheap to ask.

Plus the retention split (ADR-0011) and an MCP surface: an on-disk run report, four
tools as pure functions from report to text, and MCP itself written out rather
than depended on — JSON-RPC 2.0 with newline framing is about a hundred lines,
and `handle` being a pure function is worth more than the package.

## Measured

**The offload works.** A document acquired in jsdom — a host with no layout
engine, no compositor, no fonts — renders in Chromium to a subject with real
geometry, responds to the styling the document carried, and produces a
byte-identical image whether the renderer is in-process or on the other side of
an HTTP hop. That is ADR-0002's sub-renderer, working, and the direct answer to
paying for a container on every tier.

**Pruning is a transport result, not only a correctness one.** The document ships
the applicable rules — on this corpus 1007 → 1 — so an offloaded render is not the
whole application crossing a network.

**The end-to-end, on `broken-toggle` at `page/todos--populated`:**

```
what a pixel differ reports:  1530 pixels changed
what this reports:            5 region(s)
  cause       933px in 2 region(s) — Text     src/ds/components.tsx:42
  cause        86px in 2 region(s) — Toggle   src/ds/components.tsx:107
                in checkbox "Mark "Prove the tiering" as done"
  collateral  511px in 1 region(s) — Stack    src/ds/components.tsx:27
```

## What was found

### Area measures displacement, not cause

The most useful thing this cycle produced, and it is a negative result.

Attributed geometrically and ranked by area, that report reads Text (933), Stack
(511), Toggle (86). Every attribution is correct — the pixels really are inside
those nodes — and the ordering is still wrong. `Stack` was not edited; it was
reflowed by the edit, and it outranks the edit by 6×.

This is the same defect the differ had when a list reorder blamed the element
that moved rather than the code that moved it (journal 0009), reappearing in a
tier that has no provenance to fix it with. Geometry has no access to *why*.

So the raster tier stopped claiming to rank. `rankRegions` takes the ordering
from the semantic tier, which has provenance and props digests, and the raster
regions become evidence rather than the verdict. On this case that promotes
`Toggle` above `Stack` while leaving every attribution untouched.

Two limits kept visible. The semantic tier names **two** causes here — `Toggle`
and `Text`, both real, since replacing a native control with a styled div
restructures both — and nothing collapses them to one, because picking one would
be inventing a fact. And with no causes supplied the fallback is area, which is
honest and is not good.

### `unattributed` meant less than it was written to mean

The doc comment claimed it catches paint escaping its box — shadows, outlines,
overhanging glyphs. The test showed otherwise: a screenshot clipped to the
subject means the root's box contains every pixel in it, so escaping paint lands
in an ancestor and naming that ancestor is the *true* answer, not a consolation.

What the flag actually catches is a region landing outside the tree entirely, and
the overwhelmingly likely cause is a wrong `scale` or `origin`. That failure is
worth a loud signal precisely because it does not look like one: at the wrong
scale every region lands in the top-left quadrant and the report comes out
complete, plausible, and about the wrong components. Hence `scale` is required
with no default.

### `document.fonts.check` does not answer the font question

The renderer's substitution check was built on it and reported nothing, always.
It answers "are the fonts needed to render this text loaded" — for a family not
declared in any `@font-face` that is trivially yes, because the browser falls
back and paints something. It returned `true` for a family invented on the spot.

Replaced with a metric probe: a family that resolves changes the measured width
of a sample away from the generic it would fall back to. Three generics, because
a real font can coincidentally match one. It now reports a metric-compatible
substitute as missing — a false alarm, which is the safe direction, and the same
hole ADR-0010 left open under "one machine".

### The acquired document is engine-serialized

Declaration values arrive from the host's CSSOM: jsdom writes `rgb(18, 52, 86)`
where the author wrote `#123456`. Deliberately not canonicalized — a collector
that normalizes is a second ruleset versioned by nothing (ADR-0001) — so two
engines address the same page differently and a render cache is per acquiring
engine. A missed hit, never a wrong image.

## Cost

Nothing new was rendered for the end-to-end: it is the same two screenshots the
pixel arm already takes, read further. The chain after the screenshot —
compare → isolate → attribute → rank → report — is pure computation over a
bitmask and a snapshot.

## State

555 passed, 3 skipped. Corpus measurements unchanged: jsdom 38/38, chromium
39/39, zero false verdicts. Nothing pushed, nothing published.

## Left open

- **The document is not proven to paint what was acquired.** It is proven to
  paint *something* with the subject's geometry that responds to its styling. A
  real equivalence needs a chromium-acquired document and a chromium-rendered
  original compared pixel for pixel, and the engine-serialization difference
  above means the jsdom and chromium documents are not identical values to begin
  with.
- **`rankRegions` has one measurement behind it.** One mutation, one story.
- **The MCP layer has never served a real agent.** The tools are shaped by
  argument about what an agent would need and tested against text, not against an
  agent that used them and either fixed the thing or did not.
- **Region granularity is one number.** `cell: 8` was chosen by argument — a word
  should be one region — and never swept.

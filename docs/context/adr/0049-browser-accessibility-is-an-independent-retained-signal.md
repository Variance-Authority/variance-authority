# ADR-0049 — Browser accessibility is an independent retained signal

**Status:** accepted
**Date:** 2026-08-25
**Extends:** ADR-0002 (observation profiles), ADR-0007 (portals belong to the
component boundary), ADR-0027 (baseline sidecars carry attribution), ADR-0044
(capture material and rendering placement are independent)

## Context

The semantic collector computes roles, accessible names, descriptions, and ARIA
state. That computation is intentionally partial: it does not own browser CSS
visibility, pseudo-content, platform mappings, or the complete accessible-name
algorithm. Playwright already exposes the engine-computed tree as an ARIA
snapshot.

The durable raster path settles on pixels. When a candidate and baseline paint
identically, `decide` returns `unchanged` even if the markup or accessible tree
changed. A renamed `aria-label` is the direct case: valuable, invisible, and
cheap to observe in the browser that already owns the page.

Treating the ARIA snapshot as a diagnostic on the candidate would not close that
gap. A comparison needs both revisions, acceptance must promote the evidence a
reviewer saw, and the cheap digest path must not settle without consulting it.

## Decision

**A Playwright acquisition records the browser-computed accessibility tree as a
versioned, content-addressed signal independent of the captured document and
pixels.**

The acquisition snapshots the subject locator and each React portal content root
in component-tree order. It stores Playwright's machine-readable ARIA text, the
browser engine, the producer format, and their digest. Temporary portal markers
are installed only after document and semantic collection and are restored
before screenshots.

The evidence travels on `CaptureArtifact` and the raster sidecar. Durable,
remote, and tribunal stores preserve it; the render cache strips it because a
cache owns pixels, not acquisition evidence. Baseline descriptions expose the
snapshot so document-digest settlement requires accessibility equality too.

The snapshot is boundary-relative evidence, not a claim to be a complete
platform accessibility tree. No exposed ARIA nodes is an observed empty snapshot,
and a snapshot with no parent or no children is an observed partial snapshot.
Both are hashed and compared as readings. Only absence of the accessibility
field means the boundary was not observed.

An observation records three named results: document, pixels, and browser
accessibility. The document result states whether reconstruction input moved; it
selects whether pixels must be produced and is not itself a raster verdict.
`unchanged` is unavailable when either independently observed output — pixels or
browser accessibility — changed. An accessibility snapshot present on only one
side, or produced by a different engine or format, is `incomparable`, never an
empty tree. An accessibility-only change has no invented rectangle; the retained
before and after trees are its diff.

## Consequences

Markup-only, raster-only, and accessibility-only movement remain distinguishable
in one report. A browser accessibility regression can fail a run with zero
changed pixels, while a visual change can state that the accessibility tree was
quiet.

Legacy baselines contain no browser accessibility evidence. The first
Playwright comparison against one is incomparable until the operator promotes a
candidate, rather than silently claiming the missing boundary is unchanged.

The sidecar and report may contain accessible names and text that are absent
from the screenshot. Their retention and access policy must therefore be at
least as strict as semantic snapshot retention. The evidence is browser- and
producer-specific; upgrading either may require baseline review even when the
application did not change.

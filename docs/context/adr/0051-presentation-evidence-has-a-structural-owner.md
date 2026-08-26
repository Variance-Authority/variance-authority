# ADR-0051 — Presentation evidence has a structural owner

**Status:** accepted
**Date:** 2026-08-26
**Extends:** ADR-0050 (presentation relationships are evidence, not a design
policy)

## Context

A locator establishes what the browser acquires. It does not establish that all
descendants participate in one relationship. A composition can contain prose
and an illustration; the illustration can contain a header, a list and a
footer; the list can contain repeated rows. Reading the broad capture as one
flat peer set turns correct nesting into presentation findings.

The reverse problem also exists. One visual flow can cross implementation
wrappers. A navigation brand and its controls may live in separate containers
while the product still expects them to share a vertical centre. DOM ancestry
alone cannot authorize or reject that comparison.

## Decision

**Every derived presentation finding and paint instruction names the graph node
that owns its relationship. Reading defaults to one owner; folding descendants
into a subtree or selecting a visual flow across wrappers is explicit.**

`PresentationFinding.owner` identifies the node whose immediate relationship
produced the evidence. Finding ids are deterministic within one report. Paint
instructions retain owner, touched nodes and, where applicable, pattern and
finding ids.

`focusPresentation` is a pure projection over an existing report. Its default
depth returns the owner and immediate children, includes only evidence owned at
that level, and separately counts nested evidence. `depth: 'subtree'` includes
descendant owners only when the caller deliberately asks for a holistic
reading. Finding ids can narrow the projection to one question.

`inspectPresentationAlignment` measures an explicit set of descendant nodes
inside one owner. It returns the selected alignment coordinate, spread and
per-member deviations. The API refuses missing members, fewer than two distinct
members and members outside the owner. It does not decide whether the measured
spread is acceptable or create a finding. The reading carries paint for its
median axis and selected members; `paintPresentationAlignment` reuses it without
acquisition.

Painting a focused result reuses its existing instructions and does not acquire
the browser again.

`inspectPresentationSpacing` measures consecutive immediate children at an
explicit owner. Unlike automatic repetition findings, it does not require those
children to share a semantic shape. It retains every adjacent distance, boundary
strength and spacing cluster, and summarizes their ranges without choosing a
preferred gap or turning variation into a finding. Requiring one structural
level and a consecutive run prevents unrelated descendants from being flattened
into an apparent rhythm.

## Consequences

An agent first maps composition, boxes and flows, then chooses the owner of the
relationship it is answering. Nested findings no longer masquerade as defects
of a broad page or section. Product-aware comparisons can still cross wrappers
without teaching the analyzer that every descendant is a peer.

The report becomes slightly larger because findings and paint instructions
carry ownership and correlation ids. Those fields replace repeated browser
acquisition and broad overlays with deterministic pure projections.

Ownership is structural evidence, not a semantic oracle. The caller remains
responsible for deciding whether a composition should be read holistically,
whether a box owns the relationship, and whether selected nodes form one visual
flow.

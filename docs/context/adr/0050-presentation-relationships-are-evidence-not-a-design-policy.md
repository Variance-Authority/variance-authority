# ADR-0050 — Presentation relationships are evidence, not a design policy

**Status:** accepted
**Date:** 2026-08-26
**Extends:** ADR-0002 (absent is not empty), ADR-0006 (host-free derivation),
ADR-0013 and ADR-0042 (package boundaries and names), ADR-0049 (browser
accessibility is an independent retained signal)

## Context

The semantic snapshot records the document inputs that can move a rendering, and
the raster tier records the pixels that resulted. Neither representation answers
how rendered objects relate at one point in time: which peers align, whether
within-object and between-object spacing remain distinguishable, which text
shares a baseline, or whether one repeated object diverges from a dominant local
grammar.

Those questions tempt global design rules. Page height, density, margin width,
spacing size, and viewport utilization are easy to measure and easy to turn into
thresholds. Each can be correct at either extreme. Treating one as a defect would
give the analyzer authority over the product's information and visual culture,
which it does not have.

## Decision

**Presentation analysis derives a versioned graph and independent relationship
findings from an existing browser capture. Telemetry never fails a presentation
by itself, and the analyzer makes no design recommendation or global quality
score.**

`@variance-authority/presentation` owns both a pure analysis entry point and a
Playwright sensing entry point. The pure entry consumes plain `RawCapture` data
and optional browser accessibility evidence with no DOM, browser, filesystem, or
third-party runtime. The Playwright entry owns acquisition and paint: it hands
the capture to the pure analyzer and sends the resulting paint instructions back
to the page.

The sensing entry is separate from the visual-regression observation and
baseline lifecycle. It creates no stored reference, approval, pass/fail verdict,
or regression classification. Comparing two reports is optional feedback around
an edit, not the identity of the offering.

The graph retains boundary-relative element references, semantic class and
state, geometry, typography, surfaces, prominence, and measured relations.
Derived clusters and repeated patterns are local evidence. A presentation drift
finding requires a dominant peer grammar and a deviation that available semantic
state does not explain.

The initial thresholds are calibration constants pinned by paired firing and
non-firing fixtures. They are not exposed as design targets. Changing them is a
change to the analyzer's format behaviour and requires its acceptance cases to
move with an explanation.

The report retains Playwright's ARIA snapshot unchanged. Empty and partial roots
are observed values; only absence is unobserved. A capture profile without layout
produces semantic anchors and content telemetry while layout-derived fields are
absent. A profile claiming layout while omitting an element rectangle is refused.

Paint is generated from the same report a coding agent reads. The overlay is
diagnostic, removable, excluded from the next acquisition, and carries layer and
measurement identities so a human can inspect the grouping rather than trust a
prose conclusion.

## Consequences

An agent can reason about dense, sparse, long, or narrow interfaces through the
same relationship vocabulary. Information volume remains visible during a
before/after comparison, so deleting content cannot masquerade as presentation
improvement.

The first analyzer is deliberately local. Repetition is inferred among sibling
objects, text baselines are typographic approximations with explicit confidence,
and semantic state is evidence rather than proof of intent. Broader inference or
optical analysis can add evidence without changing the authority boundary.

This forecloses findings such as `DENSITY_TOO_HIGH`, `MARGINS_TOO_LARGE`, or a
single UI score. It also forecloses automatically choosing tables, cards,
accordions, spacing values, or content removal. Those decisions remain with the
product-aware coding agent.

---
id: TASK-17
title: Audit landing-page story and section communication
status: Done
assignee:
  - '@codex'
created_date: '2026-08-28 05:42'
updated_date: '2026-08-28 05:56'
labels: []
dependencies: []
references:
  - site/app/page.tsx
type: docs
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Review the complete public landing page section by section, then independently challenge the page-level story and recommend additions, removals, splits, merges, and ordering.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every numbered section plus the hero, integration close, and footer or navigation receives an evidence-backed communication review
- [x] #2 A separate story-coherence pass recommends which sections to add, remove, split, merge, and reorder
- [x] #3 The final report provides a prioritized replacement story and concrete content directions without editing the page
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inventory the rendered page and each section boundary.
2. Derive the visitor problem and supported promise from demonstrable product behavior; treat context records as agent provenance, not product authority.
3. Delegate all sections across independent reviewers.
4. Give the assembled findings to a separate reviewer for a whole-story challenge.
5. Synthesize a prioritized replacement architecture without editing the page.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Evidence correction: docs/context records agent attempts and rationale. They may explain current wording but do not establish the landing-page product decision; capability claims require source, tests, or runnable output.

Section audit completed across three independent reviewers. Converged findings: promote one-run/multiple-evidence-slices and causal review; keep React but expose Fiber ownership plus prop/context/hook-state evidence; remove naming lore; split sensitivity evidence from configuration; merge static UI-state and runtime test-file selection; recast report around cause grouping and bounded acceptance; route non-visual instruments and package inventory away; move integration earlier; treat agent as a secondary route. Two factual defects found: the runtime mock names test cases although the shipped Vitest integration selects test files, and the hero presents 39/40 digest settlement although typical render-skip share remains an it.todo measurement.

Validation: rendered localhost page inspected through a full DOM snapshot and visual scan; three section reviewers covered nav, hero, all 12 numbered sections, close, and footer against source/public exports/tests; an independent fourth reviewer produced the whole-page disposition and replacement spine. Landing-page source was not edited.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Completed a review-only landing-page audit. The evidence supports a cause-first visual-review story: correlate multiple readings, trace through React inputs to source, group repeated effects into one bounded decision, then qualify fit and route to the existing host. Recommended removing package/platform taxonomy from the primary story, merging selection layers, moving integration earlier, and correcting unmeasured or overstated mocks and setup claims. Verified in the rendered page, source/public contracts, focused tests run by reviewers, and an independent story-coherence pass; no landing-page files changed.
<!-- SECTION:FINAL_SUMMARY:END -->

---
id: TASK-18
title: Rewrite landing page around causal visual review
status: Done
assignee:
  - '@codex'
created_date: '2026-08-28 06:10'
updated_date: '2026-08-29 08:59'
labels: []
dependencies:
  - TASK-17
references:
  - site/app/page.tsx
  - TASK-17
type: docs
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Replace the current feature and package catalog with a cause-first adopter story: connect multiple UI readings to React and source evidence, group repeated effects into one bounded review decision, explain selective execution and operating boundaries, and route visitors to the host their UI already uses. Preserve the existing visual system and keep the change uncommitted for user review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The opening states the causal-review outcome before license, hosting, package, or mechanism details
- [x] #2 The page explains independent evidence slices and React Fiber input evidence without naming-grammar lore or unsupported universal claims
- [x] #3 The report and agent sections show bounded review and intent verification without implying unavailable execution capabilities
- [x] #4 Static and runtime selection are presented as one outcome with correct UI-state and Vitest test-file granularity
- [x] #5 The integration chooser appears before repository architecture and gives distinct Playwright, Storybook, route, and jsdom paths
- [x] #6 The rendered page passes repository checks and manual browser review with no broken navigation or console errors
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Rebuild the page spine around causal visual review while preserving the existing visual language and responsive shell.
2. Rewrite the hero, evidence-slice, React, report, agent, selection, fit, and integration sections using verified product behavior.
3. Remove package/platform taxonomy and internal lore from the primary scan path; correct mocks and integration prerequisites.
4. Build the site, run relevant repository checks, and inspect the rendered desktop and narrow layouts in the browser.
5. Leave all changes uncommitted for user review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Carry-the-load card
Value: A technical adopter can understand the causal-review outcome, see proof, qualify fit, and choose an existing host without reading repository architecture.
Current flow: localhost landing page → feature/mechanism sections → package inventory → integration chooser → browser/build verification.
Constraint: The current section taxonomy hides the review outcome and contains unmeasured or overstated examples.
Increment: Rewrite the single landing page and its existing presentation components; no product behavior, public docs, deployment, or package changes.
Misfire: The rewrite becomes another broad capability catalog, overstates unavailable behavior, or breaks responsive navigation.
Containment: Uncommitted site-only changes; Git retains the current page; unrelated components may remain unused rather than being deleted.
Readback: Expected—opening, proof, fit, and host route are visible in order at desktop and narrow widths, build/checks pass, and console/link inspection is clean. Disconfirming—mechanisms precede value, unsupported claims remain, routes are incomplete, or rendered checks fail. Review point—localhost:3000 before any commit.
Learning owner: implementation.
<!-- SECTION:NOTES:END -->

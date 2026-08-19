---
id: TASK-5
title: Prove dynamic-route flakes as composition collateral
status: Done
assignee: []
created_date: '2026-08-19 05:42'
updated_date: '2026-08-19 06:46'
labels: []
dependencies: []
priority: high
type: enhancement
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add a runnable Playwright example where a dynamic image route changes an unrelated region between readings, producing a visual diff despite no active CSS or HTML change. Use composition to distinguish that environmental flake from an active component change and demonstrate the safe ignore/refusal outcome.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A real browser example returns different image bytes from the same dynamic route and produces an image-region pixel diff while its DOM structure and image URL remain unchanged.
- [x] #2 The example derives that image region through the existing pixel-mask to DOM-box to React Fiber/component to source pipeline, with no production test-attribution or ignore markup.
- [x] #3 A second read with the same active source state retains the active source change as reviewable and classifies the repeated unchanged-source image movement as a flake rather than an active-component regression.
- [x] #4 Reader documentation labels this as advanced flake/composition machinery and states its showcase, proof, and boundary.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Replace the hand-supplied DynamicImage movement with the existing observation path: pixel mask, region isolation, geometry attribution, React Fiber ownership, and source resolution. 2. Keep the dynamic SVG route entirely in the Playwright test harness and verify unchanged DOM/image structure plus image-only pixels on the second read. 3. Use the real observed region as composition input; retain the active source edit and classify only the repeated, unchanged-source image movement as a flake. 4. Update the example documentation and verify the browser proof, static checks, full suite, and an independent documentation review.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented a browser-navigated Playwright route that serves different SVG bytes from one image URL. The proof separates PriceTag pixels from dynamic-image pixels and exercises composition as edited versus unexplained flake. Focused Chromium test and docs-links/boundaries checks pass.

Final verification: full Vitest suite passed (171 files, 2266 tests, 20 todo). The focused browser proof verifies same URL/different SVG bytes, zero PriceTag pixels across image-only reads, named dynamic-image ignore marker, and composition classification of PriceTag as edited versus DynamicImage as unexplained flake. Fresh documentation gate: PASS.

User-directed correction: data-variance-ignore is not appropriate here. The controlled route remains test-only; the proof must be screenshot/structure/composition evidence, not production annotation.

Approach corrected at user direction: use Variance’s existing pixels → regions → DOM/Fiber → source pipeline; do not hand-supply DynamicImage as a movement.

Final evidence: focused Chromium proof passed (4/4); type build, doc example index, docs-links (444), and boundaries (819) passed; full Vitest suite passed. Independent architecture, documentation, and isolated output-context reviews passed. The repeated image diff is correctly retained as sub-semantic instability located at DynamicImage, not as a DynamicImage source accusation.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Added a runnable React/Playwright dynamic-route flake example that uses the existing pixel mask → region → DOM box → Fiber component → source path. Same-URL image bytes identify DynamicImage as the pixel location, while PriceTag remains the source-backed review candidate. A second active read proves image-only sub-semantic instability without production attribution or ignore markup. Verified by Chromium proof, static checks, full suite, and independent reviews.
<!-- SECTION:FINAL_SUMMARY:END -->

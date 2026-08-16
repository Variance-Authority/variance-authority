---
id: TASK-2
title: Establish Variance Authority visual guidelines and package branding
status: Done
assignee:
  - '@codex'
created_date: '2026-08-16 04:20'
updated_date: '2026-08-16 04:30'
labels: []
dependencies: []
references:
  - docs/context/checkpoint.md
  - /Users/marinakorzunova/Downloads/Variance Authority logo.svg
  - /Users/marinakorzunova/Downloads/Variance Authority mark.svg
priority: medium
type: docs
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Define the Variance Authority visual system from the supplied fork mark and make every published package visibly part of the same system. The mark is the bottom-rooted fork with one selected amber route; the triangle sketch is not the logo. Keep the current product documentation truthful and make package-local assets available to package README readers.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A current visual-guidelines document records the mark geometry, palette, semantic use of amber and green, illustration grammar, typography, spacing, and do-not-use boundaries.
- [x] #2 Repository-owned logo and mark SVG assets preserve the supplied fork mark and are referenced from the root README.
- [x] #3 Every workspace package README has consistent package-local logo treatment, and its package manifest includes the asset in the published files.
- [x] #4 Documentation links and package asset paths resolve, and the repository verification suite passes.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Add repository-owned `assets/brand/variance-authority-logo.svg` and `assets/brand/variance-authority-mark.svg` from the supplied fork artwork, preserving the warm graphite/ivory/grey/amber treatment.
2. Add `docs/visual-guidelines.md` as the current public visual contract: mark anatomy and usage, palette tokens, semantic accent rules, illustration generation grammar, typography, spacing, and exclusions.
3. Add the full wordmark to the root README and add a package-local mark plus consistent header treatment to every workspace package README.
4. Add the package-local mark to each manifest `files` list so published package pages can resolve it without reaching outside the package.
5. Run the documentation/path checks and the full build/verify sequence, then inspect the generated package contents and diffs.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Validation passed: local build stages completed (`doc-examples`, TypeScript build, page-agent generation, and tribunal migrations). `oxlint` passed. The documentation/static suite passed 2,356 tests with 1 existing todo. The elevated full suite passed 165 test files: 2,209 passed, 48 skipped, and 20 existing todo tests. Custom checks verified 23 package README/manifest/mark triples, byte-identical package marks, SVG fork geometry and amber routes, and `git diff --check` passed. Yarn itself is not installed in this shell, so the declared yarn scripts were run through their local Node binaries.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Established the Variance Authority visual contract around the supplied bottom-rooted fork mark with one selected amber route, explicitly excluding the triangle interpretation. Added full and compact SVG assets, linked the full logo from the root README, added the mark to all 23 package READMEs, and included each mark in its package files list. Verified with the repository build stages, oxlint, documentation/static checks, the elevated full test suite, and package/asset consistency checks.
<!-- SECTION:FINAL_SUMMARY:END -->

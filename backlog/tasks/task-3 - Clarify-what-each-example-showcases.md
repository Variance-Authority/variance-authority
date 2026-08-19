---
id: TASK-3
title: Clarify what each example showcases
status: Done
assignee: []
created_date: '2026-08-19 04:40'
updated_date: '2026-08-19 04:47'
labels:
  - documentation
  - examples
dependencies: []
documentation:
  - README.md
  - docs/cases.md
  - cases/README.md
  - examples/readme-case/README.md
  - examples/kitchen-sink/README.md
  - examples/todomvc/README.md
  - cases/storybook-case/README.md
  - cases/incumbent-case/README.md
priority: medium
type: docs
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make each repository example and case state whether it demonstrates ordinary visual regression or an advanced Variance Authority capability, then name the evidence and boundary it carries. Keep the canonical detail at the existing example/case README surfaces and align the root README chooser with that classification.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Every example and case README names its showcase class: ordinary visual regression or a specific advanced capability.
- [x] #2 Each classified surface states what the example proves and its material boundary without promoting activity into beneficiary-visible proof.
- [x] #3 The root README and cases index route readers to the examples by capability, from ordinary visual regression to advanced workflows.
- [x] #4 Documentation links, example compilation, and repository-native documentation checks pass, with any pre-existing failures reported.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Inventory all example and case README entry points and the root/cases chooser.
2. Add a compact showcase classification, proof statement, and boundary to each canonical surface without duplicating implementation detail.
3. Align the root README and cases index so readers can choose ordinary visual regression or advanced capability examples.
4. Run generated-example, link, claim, and type checks; record any pre-existing failure.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Updated seven canonical README/index surfaces with explicit Showcase, What it proves, and Boundary language. Added capability-based routing to the root README and cases index. Validation: doc-examples wrote 32 examples; tsc --build --force passed; git diff --check passed; documentation checks passed 2363 tests with one pre-existing docs-claims failure because checkpoint.md states 146 markdown files while git ls-files reports 148; isolated output-context review returned PASS.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Clarified every example and case as ordinary visual regression or an advanced capability, with explicit proof and boundary statements. Root and cases indexes now route readers by showcase. Verified generated examples, TypeScript, diff hygiene, links, shape, boundaries, skips, and output-context integrity; reported the existing checkpoint count mismatch.
<!-- SECTION:FINAL_SUMMARY:END -->

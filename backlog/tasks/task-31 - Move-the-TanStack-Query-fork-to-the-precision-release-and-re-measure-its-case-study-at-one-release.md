---
id: TASK-31
title: >-
  Move the TanStack Query fork to the precision release, and re-measure its case
  study at one release
status: To Do
assignee: []
created_date: '2026-10-16 11:54'
updated_date: '2026-10-16 22:46'
labels: []
dependencies: []
references:
  - docs/selection-tanstack-query.md
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The case study docs/selection-tanstack-query.md shows one query-core change asked of each precision step (149/149/149/83/9 of 188) and a loop a reader runs on github.com/Variance-Authority/tanstack-query-example. The fork cannot run it yet: it has no variance.config.json declaring suite unit (so a recording lands in coverage.bin, not suites/unit/coverage.bin), and it pins a release that refuses precision. The rest of the page (H1 78%, TLDR bullets 1, 2 and 5, the sixty-commit section) and the TanStack column of the comparison table in docs/coverage-test-selection.md were measured at 0.3.0, while the one-line section, the index section and the precision table were measured at the precision release. Measure one commit end to end before any batch.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The fork depends on the release that ships precision and commits variance.config.json declaring suite unit; the page's reproduce block run verbatim on a fresh clone gives 149/149/149/83/9
- [ ] #2 The fork's VARIANCE.md reads nine test files for the one-line change
- [ ] #3 Every figure on docs/selection-tanstack-query.md comes from one release, or the sixty-commit section is removed
- [ ] #4 The TLDR defines the walk before it names it
<!-- AC:END -->

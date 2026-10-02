---
id: TASK-23
title: >-
  Say why built output no tsconfig emits stays unresolved, and name the `source`
  fix
status: To Do
assignee: []
created_date: '2026-10-02 05:39'
updated_date: '2026-10-02 05:54'
labels:
  - sense
  - resolution
dependencies: []
references:
  - docs/context/adr/0080-built-output-is-read-as-its-source.md
  - docs/specs/0055-a-workspace-import-resolves-to-its-source.md
  - packages/sense/native/src/emitted.rs
  - packages/sense/native/src/orient_map_entries.rs
type: bug
ordinal: 50000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ADR-0080 (accepted) reads a resolution under a workspace package's `outDir` as the file under `rootDir` it is emitted from, and decides that a package whose code another tool builds, with no tsconfig naming that output, keeps the hole ("What this forecloses"). What a reader is told about that hole is not decided. Spec 0055 section 13 leaves it open and recommends option (a): the record carries a sentence with the reason (`its tsconfig sets noEmit` or `no tsconfig there emits a file`) and the one-line fix, a `source` condition in the member's manifest. No such sentence was found in sense; only `packages/sense/src/scan.ts:25` mentions the `source` condition.

Motivating case: TanStack query, `packages/angular-query-experimental`. `build` is `tsdown --tsconfig tsconfig.prod.json`, whose `outDir` is `./dist-ts` (inherited) with `rootDir: ../../`, so nothing names `dist/`. The `"."` export resolves through `@tanstack/custom-condition: ./src/index.ts`; `./devtools`, `./devtools-panel` and their `/production` subpaths point only at `dist/*.mjs` and resolve to no source, in the store and in the code map's manifest entries (`orient_map_entries::declared`), which put no file of `src/devtools*` on the shipped side.

Clarify first, with the owner: whether option (a) is adopted, whether spec 0055 is discharged or still open, and whether any surface (store record, `variance ask`, code map) already carries such a sentence. Only after that, classify each surface that drops such an entry silently as a bug, or record the position where it is meant to be silent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The task records the owner's decision on spec 0055 section 13 (option (a), option (b) or neither), and whether spec 0055 is discharged, with file:line evidence of what sense says today
- [ ] #2 Under the decision, each surface that shows a specifier or manifest entry landing in such output either carries what the decision requires or has its silence recorded as a position
- [ ] #3 A manifest entry the code map cannot read as source is not dropped from its shipped side without the decided treatment
- [ ] #4 If a sentence is adopted, a fixture package built by a bundler, whose tsconfig sets `noEmit`, pins it through the real seam, failing on the code before the fix
<!-- AC:END -->

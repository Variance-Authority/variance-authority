---
id: TASK-23
title: >-
  Say why built output no tsconfig emits stays unresolved, and name the `source`
  fix
status: To Do
assignee: []
created_date: '2026-10-02 05:39'
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
ADR-0080 reads a resolution under a workspace package's `outDir` as the file under `rootDir` it is emitted from. A package whose code another tool builds, with no tsconfig naming that output, keeps the hole by decision (ADR-0080 "What this forecloses"; spec 0055 section 13, option (a)). Option (a) also promises the record a sentence: the reason (`its tsconfig sets noEmit` or `no tsconfig there emits a file`) and the one-line fix, a `source` condition in the member's manifest. No such sentence was found in sense; only `packages/sense/src/scan.ts:25` mentions the `source` condition.

Motivating case: TanStack query, `packages/angular-query-experimental`. `build` is `tsdown --tsconfig tsconfig.prod.json`, whose `outDir` is `./dist-ts` (inherited) with `rootDir: ../../`, so nothing names `dist/`. The `"."` export resolves through `@tanstack/custom-condition: ./src/index.ts`; `./devtools`, `./devtools-panel` and their `/production` subpaths point only at `dist/*.mjs` and resolve to no source, in the store and in the code map's manifest entries (`orient_map_entries::declared`), which put no file of `src/devtools*` on the shipped side.

Clarify first: is section 4's sentence built anywhere (store record, `variance ask`, code map), and is spec 0055 discharged or still open? Then classify each surface that drops such an entry silently as a bug, or record the position where it is meant to be silent.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The task records, with file:line evidence, whether spec 0055 section 4 sentence exists for a specifier that lands in output no tsconfig emits, and whether spec 0055 is discharged
- [ ] #2 A specifier or manifest entry that lands in such output carries the reason and names the `source` condition fix wherever a reader is shown it, or the task records the position that it stays silent there
- [ ] #3 A manifest entry the code map cannot read as source is not dropped silently from its shipped side: it is reported with the same reason, or the position is recorded
- [ ] #4 A fixture package built by a bundler, whose tsconfig sets `noEmit`, pins the reason through the real seam, failing on the code before the fix
<!-- AC:END -->

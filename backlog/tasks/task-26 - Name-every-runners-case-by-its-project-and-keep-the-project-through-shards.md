---
id: TASK-26
title: 'Name every runner''s case by its project, and keep the project through shards'
status: To Do
assignee: []
created_date: '2026-10-09 08:41'
labels:
  - sense
  - selection
dependencies: []
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
PR #263 spells a case run by a named project as `|project| file > name` for Vitest, Jest and Playwright. Two gaps remain. Rstest: its case context carries only `projectRoot`, and a `projects` config gets no setup file of ours to pass a name in, so a second Rstest project's copy of a case is still numbered `#1` (`// FIXME` in the Rstest wrapper in `packages/sense/src/test-selection/worker-source.ts`). Shards: nothing tests that the case index's `tests.project` column survives splitting a run into shards and joining them back, so an id could drift between a sharded and a whole run without a failing test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two Rstest projects running one file give its cases distinct ids, and a run filtered to one project gives the same id as the full run, pinned by a test that fails before the change
- [ ] #2 The Rstest FIXME in worker-source.ts is gone, and the Sense README and changeset stop listing Rstest as keeping plain ids
- [ ] #3 A test splits a run with two named projects into shards, joins them, and finds every case with the id the whole run gives it
<!-- AC:END -->

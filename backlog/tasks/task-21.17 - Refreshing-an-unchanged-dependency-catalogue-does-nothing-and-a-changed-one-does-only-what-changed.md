---
id: TASK-21.17
title: >-
  Refreshing an unchanged dependency catalogue does nothing, and a changed one
  does only what changed
status: In Progress
assignee: []
created_date: '2026-09-29 11:17'
updated_date: '2026-09-29 11:18'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An unchanged refresh of the dependency lexicon on the seven-copy Material UI corpus takes 11-12 s, against 16.7 s cold. Timed by phase: git snapshot 2.1 s, reading every import site out of the source index 5.4 s, resolving and reading entries 3.5 s, write 0.2 s. Reuse only shortens the third; the first two run identically whether or not anything changed. The catalogue is derived from three things that each already have an owner of change: the source index's immutable log (its manifest names the segments, each generation's Delta names the records and directories it adds or deletes), the checkout's manifests, and the installed packages. Nothing changed must cost a comparison of those three identities and no reading. Something changed must cost the changed files' contribution, merged into what the lexicon already holds the way index generations merge, rather than the whole request map rebuilt.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An index run over an unchanged checkout and install refreshes the lexicon in under 0.5 s on the seven-copy Material UI corpus and on Kibana, and says it changed nothing
- [ ] #2 Editing one source file's imports re-reads only that file's contribution, and the refresh's cost scales with the edit, not the checkout; measured on both corpora
- [ ] #3 The lexicon records the identities it was built from (index segments, install stamp, format version), and a refresh that finds them equal does not open the source index's records or the git tree
- [ ] #4 A changed install (one package version) recomputes that package's entries and no others
- [ ] #5 Cold and warm refresh times per phase are recorded by dependency-scale.measure.ts
<!-- AC:END -->

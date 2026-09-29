---
id: TASK-21.18
title: >-
  The source index is updated and published from its layers in Rust, not decoded
  into records
status: To Do
assignee: []
created_date: '2026-09-29 22:36'
updated_date: '2026-09-29 23:48'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every commit touches a tiny part of a giant everything, and an edit to one file re-materialised every file's record in JavaScript: on Kibana a one-file index took 6.5 s, of which the whole-log decode, the tree listing and the rewrite of Help's published value were most. Position: the layers and the tree already answer what changed, so the update is made in Rust from the layers in place (records that stand are those whose digest git names and whose witnessed directories did not move; the native walk opens only the files past them; one delta is written or the chain is compacted), and Help's published value is refreshed from the chain the same way. Nothing changed, nothing is written. TypeScript only asks and falls back when Rust declines.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 An edit to one file on Kibana appends one row for that file and writes bytes proportional to that row, not to the catalogue; measured and stated as a count of bytes written
- [ ] #2 An unchanged refresh reads the manifest and writes nothing
- [ ] #3 A manifest edit changes owners at read time and rewrites no file row
- [ ] #4 Deleting a file hides its rows via a tombstone and compaction drops them
- [ ] #5 A dependency question on Kibana opens the base in place and overlays the tail; warm latency is not slower than today and no read decodes the whole catalogue
- [ ] #6 dependency-lexicon.json, .built.json, .merge.json and the modules that maintain them are deleted, not kept as a fallback
- [ ] #7 Compaction runs off the question path and an interrupted compaction leaves the previous base and tail answerable
- [ ] #8 Implementation is Rust only; yarn build && yarn verify is green
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed: the source tree and help usage are read and encoded in Rust (source_tree.rs, help_usage.rs), the published value is refreshed from the chain natively (refresh-native.ts), and the warm update is made natively (source_update.rs, native-update.ts), byte-equal on records, directories and parse keys to the JavaScript update on the repository and on Kibana for an edit, an added file and a deleted file. Kibana one-file variance index: 6.5 s to 3.1 s; updateSourceIndex alone 2.35 s to about 0.8 s. Remaining: encodeSearchIndex in Rust and writing help.json natively, the git listing carried instead of re-derived per directory, prepareCodeMap, the lexicon's JSON rewrite, parse orphan collection at compaction.
<!-- SECTION:NOTES:END -->

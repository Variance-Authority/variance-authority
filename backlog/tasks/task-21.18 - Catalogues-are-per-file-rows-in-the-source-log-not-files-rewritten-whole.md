---
id: TASK-21.18
title: 'Catalogues are per-file rows in the source log, not files rewritten whole'
status: To Do
assignee: []
created_date: '2026-09-29 22:36'
updated_date: '2026-09-29 22:46'
labels: []
dependencies: []
parent_task_id: TASK-21
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every commit touches a tiny part of a giant everything, and the dependency catalogue's lifecycle assumes the opposite. It keeps three whole-file JSON documents beside the source index (dependency-lexicon.json, .built.json, .merge.json), each rewritten whole on any change: 100 MB+ per edit on Kibana. Around them sits machinery that exists only because the catalogue is a separate artifact from the log it is derived from: stamps, a pair-cleanliness rule, a merge planner, a clean pass, a fallback full read. Help's published value (help.json, help-search.bin, source-tree bin) is rewritten whole in the same way. locate is not in scope: a report is immutable and its in-memory index is correct.

Position to test: a catalogue is not a second artifact to refresh, it is columns of the source log. What a file contributes (its external requests, its exports, its search terms) is a pure function of that file's bytes, and the scan that wrote the source segment already parsed those bytes. So the contribution is written in the same segment, by the same writer, at the same time (carry, never recompute). There is then no refresh step, no stamp, no merge planner and no clean pass, because there is nothing separate to fall out of date. A change appends one row per changed file (a tombstone per deleted file). Anything that depends on the wider world (which manifest owns a file, what counts as internal) is joined at read time, never baked into a row, so a manifest edit does not rewrite every file's row.

Reads: a columnar base opened in place (pooled strings, term dictionary, offsets) plus the un-compacted tail overlaid, newest row wins, tombstones hide base rows. Compaction folds the tail into a new base when it passes a threshold, off the question path; readers never wait for it. JSONL is acceptable for the tail, never for the base (no random access). All encoding, folding and overlay in Rust in the sense addon next to index_chain.rs; TypeScript only asks.

Order: (1) requests + owners join, replacing dependency-lexicon.json/.built/.merge and deleting dependency_lexicon_built/merge/clean and the stamp fast path; (2) Help's search columns; (3) Help's own value as rows, only if (1) and (2) prove the shape on Kibana.
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
Design review against the code. (1) The premise 'write the contribution into the source segment' is half already true: the parse columns in the log already hold request_value/kind/line, bindings and members per file (parse_columns.rs), and external_dependencies.rs requests_of derives the lexicon's per-file requests from them at read time by joining the record's targets, the owning package list and the internal-name set. So the per-file row exists; what is stored twice is its join result (.merge.json Store.files) plus the whole fold (dependency-lexicon.json). Step 1 is therefore first a measurement: read the lexicon straight off the log with requests_of, per segment, and see whether a per-segment derived cache keyed by segment digest (immutable, never invalidated, folded on read) is needed at all. (2) The join depends on owners and internal names, both manifest-derived: they must stay read-time, or a manifest edit rewrites every row. (3) requests_of returns Err for a file whose parse is in another layer; the derived cache key must be (segment digest), and the fold must follow the same newest-row rule as index_chain fold or the two disagree. (4) Risk: a derived-per-segment cache multiplies small files; compaction must merge them, and the manifest of derived segments must be the source manifest's digests so there is one lifecycle, not two. (5) Not yet measured: what requests_of over the whole Kibana fold costs cold. That figure decides between 'no cache' and 'per-segment cache'.

Measured on Kibana (~400k... corpus in ../variance-authority-examples/kibana), one appended line in one file, node dist of the CLI, M4 Max. Files rewritten per edit: help.json 49 MB, help-search.bin 29.5 MB, help-tree.bin 14.6 MB, dependency-lexicon.json 27.7 MB, .merge.json 11 MB, .built.json 1.7 MB (about 133 MB). Wall: 'variance index' 6.5 s. By phase: updateSourceIndex 2.5 s, prepareCodeMap 0.56 s, lexicon refresh 0.20 s, readWorkspace + publish 3.4 s, read back 0.09 s. The lexicon is 3 percent of the edit; the premise that it is the 100 MB cost was wrong. Inside the 3.4 s and the rest, the CPU profile puts 1.85 s in decodeSourceIndex (dist/source-index-format.js:83: the whole log is decoded into JS objects, 1.0 s of it string decoding), 0.78 s in gitTreeOf (tree.js:263, JS), 0.43 s encodeSearchIndex, 0.56 s garbage collection. So the lifecycle defect is: an edit to one file re-materialises every file's record in JavaScript and republishes Help from it. Real target: publish Help columns and the tree from the log in Rust without decoding records to JS, append per-file rows, compact off the path. Lexicon moves with it.
<!-- SECTION:NOTES:END -->

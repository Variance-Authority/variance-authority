---
id: TASK-21.18
title: >-
  The source index is updated and published from its layers in Rust, not decoded
  into records
status: In Progress
assignee:
  - '@akorzunov'
created_date: '2026-09-29 22:36'
updated_date: '2026-10-15 23:45'
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

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Scope: the lexicon part of this task (AC 1-7 as they read for the dependency catalogue). No backward compatibility: a checkout regenerates its index.

Measured on the Jira frontend checkout (812k paths, 6,205 owners): dependency-lexicon.json is 444 MB, of which availability is 391 MB in 822,463 rows from only 51,059 (owner, package) pairs: each pair is multiplied by every subpath its install exports. 81,854 rows carry an import. Entries are 53 MB (13,471). The per-file request record (.merge.json) is 281,294 sites in 92,868 files. After PR 399 the lexicon step is 12.8-14.0 s per one-file edit, most of it building, sorting, cloning and dropping the 822k rows.

1. One binary catalogue (segment-style sections, string pool, u32 columns) replaces dependency-lexicon.json, .built.json and .merge.json: owners (manifest, directory, kinds), pairs (owner, package -> install, declared_as), offers (install -> specifier -> entry), entries (identity, names as columns, the rest per entry decoded on demand), issues, stamps of what the refresh read, and the index base it was made over.
2. Request sites are rows by file (file, package, specifier, line) for the index base only, in their own section. A file's owner is found at read time from the owners section, so a manifest edit rewrites no site row. The tail is the index's own working layer: a question reads the touched files' requests from it and drops those files' base rows.
3. A refresh after a source edit compares stamps and the tail's requested (owner, package, specifier) set with the catalogue's pairs and offers, and writes nothing when every one is held. It rewrites the catalogue only for a manifest, install or new pair/specifier, and the site rows only when the index base moves (readying, in the follow-ups, off the question path). A question over a base the catalogue was not made from compares record digests to find the files that differ, so an interrupted rebuild still answers.
4. query_dependency_lexicon and dependency_stack read the catalogue in place, decoding only the entries they match.
5. Delete the JSON lexicon, built.rs, merge.rs, clean.rs and readDependencyLexicon; tests assert through the questions. Amend ADR-0082 and docs that name dependency-lexicon.json.
6. Measure on jira: bytes written and time for a one-file edit, an unchanged refresh, and warm question latency, before and after.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Landed: the source tree and help usage are read and encoded in Rust (source_tree.rs, help_usage.rs), the published value is refreshed from the chain natively (refresh-native.ts), and the warm update is made natively (source_update.rs, native-update.ts), byte-equal on records, directories and parse keys to the JavaScript update on the repository and on Kibana for an edit, an added file and a deleted file. Kibana one-file variance index: 6.5 s to 3.1 s; updateSourceIndex alone 2.35 s to about 0.8 s. Remaining: encodeSearchIndex in Rust and writing help.json natively, the git listing carried instead of re-derived per directory, prepareCodeMap, the lexicon's JSON rewrite, parse orphan collection at compaction.

Lexicon step (branch feat/lexicon-catalogue-in-place): the JSON lexicon, .built.json, .merge.json and dependency_lexicon_built/merge/clean.rs are deleted. The catalogue is dependency-lexicon.bin (segment framing: owners, manifests, internal names, pairs -> installs -> offers -> entries with each entry's reading a blob decoded on demand, stamps, summary). Request sites are dependency-lexicon.sites.bin: a log of per-file rows over the index base, then appended ROWS/DELETED/TO_BASE/SEEN records per refresh; rebuilt whole when the base or the internal-name digest changes. A file's owner is the nearest owner directory, found at read time. A refresh writes the catalogue only when a manifest/install stamp moved or a written request names a pair or offer it lacks. Measured on the Jira frontend checkout (Apple Silicon laptop, load average 15-80): files 444 MB + 37 MB + 4 MB JSON -> 55 MB catalogue + 27 MB sites; cold build 29.8 s; one edited file (comment, known import, new specifier) appends ~450 bytes to the sites log and rewrites no catalogue, refreshDependencyLexiconNative 0.28-0.37 s; unchanged 0.2-0.4 s. Not done here: AC #5 warm question latency on Kibana not measured; compaction of the sites log happens only by rebuild when the index base moves. In variance index the lexicon step's wall time is bounded by the questions step (help.json, 7-16 s on jira) because both resolve on one JS thread.
<!-- SECTION:NOTES:END -->

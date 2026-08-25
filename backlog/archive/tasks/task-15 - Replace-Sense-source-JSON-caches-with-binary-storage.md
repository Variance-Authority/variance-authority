---
id: TASK-15
title: Replace Sense source JSON caches with binary storage
status: In Progress
assignee:
  - '@codex'
created_date: '2026-08-25 11:57'
updated_date: '2026-08-25 12:08'
labels: []
dependencies: []
references:
  - docs/context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md
  - docs/context/journal/0026-what-a-graph-costs-to-keep.md
  - packages/sense/src/cache.ts
  - packages/sense/src/reuse.ts
  - packages/cli/src/commands/resources.ts
modified_files:
  - packages/sense/src/cache.ts
  - packages/sense/src/reuse.ts
  - packages/cli/src/commands/resources.ts
  - packages/sense/README.md
  - docs/information.md
type: enhancement
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Sense source reuse persists as versioned binary artifacts. Parse and resolved-record data no longer write, read, name, document, or test JSON cache files. The binary format preserves content/layout identity, best-effort cache failure, deterministic bytes, and safe cold-scan fallback.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Parse-cache and resolved-record-cache persistence uses binary encoding with explicit magic and version validation.
- [ ] #2 The CLI creates binary cache filenames and no Sense source-cache production path reads or writes parse.json or records.json.
- [ ] #3 Missing, corrupt, truncated, foreign-version, and incompatible-layout artifacts degrade to empty cache state without changing scan answers.
- [ ] #4 Binary encoding is deterministic under code-unit ordering and round-trips requests, bindings, exports, declarations, unknown reasons, file records, digests, and edge kinds.
- [ ] #5 Sense README examples and information-flow documentation describe the binary carriers and correct default location.
- [ ] #6 Sense, CLI, build, and repository verification pass.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Freeze the binary format and cache invariants from the existing types and tests. 2. Implement deterministic versioned binary codecs for parse and resolved-record caches. 3. Change CLI cache paths and public examples to binary names. 4. Extend corruption, compatibility, and round-trip tests. 5. Run package, build, and repository verification.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Readback found the requested implementation already present on main in commits 8fcdebb, 885a66d, and de7025d. The CLI uses source-index.bin through openSourceIndex; parse and resolved-record caches share immutable binary segments. Focused Sense cache/index tests pass: 37. yarn build passes. yarn verify passes 6,255 checks and retains one todo, but two unrelated documentation inventory checks fail: checkpoint markdown count 191 vs 198 and docs/architecture.md omits the existing scenario package.

Disposition: duplicate. The requested binary source-index implementation was already committed to main before this task was created (8fcdebb, 885a66d, de7025d). No replacement implementation belongs to this task.
<!-- SECTION:NOTES:END -->

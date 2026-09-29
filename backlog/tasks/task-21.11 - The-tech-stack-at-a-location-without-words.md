---
id: TASK-21.11
title: 'The tech stack at a location, without words'
status: Done
assignee: []
created_date: '2026-09-28 03:55'
updated_date: '2026-09-29 08:53'
labels: []
dependencies:
  - TASK-21.9
  - TASK-21.10
parent_task_id: TASK-21
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The bulk question an agent asks before writing code: what can this location already use? Today `search` needs a query and caps matches, and `orient --files` lists observed imports and a short declaration list. A words-free answer from a path lists every third-party solution usable there, grouped by role (runtime, test, build, types-only), split into imported here and declared but unused, and names the house solution when the area already uses one package for a job. It pages like the code map (TASK-21.6) and reads only the published index and catalogue.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Given a path and no query, the answer lists every dependency usable at that path under the ownership rule, each with its role, declaration kind, version and local import count
- [x] #2 Imported and declared-but-unused dependencies are listed separately; an unreadable declaration or import is reported as unread, not omitted
- [x] #3 The answer pages with a stable order and says how many entries remain
- [x] #4 The answer for packages/help/src/server.ts in this repository matches its manifest and its source imports
- [x] #5 Nothing reads source text or installed package files at question time
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
`variance ask stack --from <path>` (`docs_stack`) lists every third-party package usable at the path under the ownership rule: role (runtime, dev, types-only), declaration kind, version and local import count. Imported, declared-and-unused and imports-not-read are separate groups; declarations the resolver could not read are listed with the reason. Rows page in a stable order with `--limit`/`--offset` and a count of what remains. Computed in Rust from the published lexicon's availability rows (`dependency_stack.rs`); nothing is read at question time. On packages/help/src/server.ts it lists vitest (imported, declared at the root) and minisearch (dev), matching the manifest and imports. Roles are runtime, dev and types-only; test and build are not distinguished because no evidence separates them from dev.
<!-- SECTION:FINAL_SUMMARY:END -->

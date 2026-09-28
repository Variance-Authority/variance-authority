---
id: TASK-21.11
title: 'The tech stack at a location, without words'
status: To Do
assignee: []
created_date: '2026-09-28 03:55'
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
- [ ] #1 Given a path and no query, the answer lists every dependency usable at that path under the ownership rule, each with its role, declaration kind, version and local import count
- [ ] #2 Imported and declared-but-unused dependencies are listed separately; an unreadable declaration or import is reported as unread, not omitted
- [ ] #3 The answer pages with a stable order and says how many entries remain
- [ ] #4 The answer for packages/help/src/server.ts in this repository matches its manifest and its source imports
- [ ] #5 Nothing reads source text or installed package files at question time
<!-- AC:END -->

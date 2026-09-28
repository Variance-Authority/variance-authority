---
id: TASK-21.10
title: Every third-party answer carries its evidence
status: To Do
assignee: []
created_date: '2026-09-28 03:54'
updated_date: '2026-09-28 03:55'
labels: []
dependencies:
  - TASK-21.9
parent_task_id: TASK-21
ordinal: 41000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
An agent deciding whether to use a dependency needs to see why the answer says it may. Each third-party hit from `search` and `symbol` names the manifest that declares it, the declaration kind (dependency, dev, peer, optional), the installed version resolved from that context, and whether code in the same area already imports it, with a count and a sample site. An empty answer states its scope (how many dependencies were searched, under which manifest) instead of reading as "nothing usable here" (ADR-0002: absent is not empty).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Each third-party hit names its declaring manifest, declaration kind and installed version, or says which of them could not be resolved
- [ ] #2 Each hit says whether the owning area imports the package, with a stable count and one source site
- [ ] #3 An empty third-party answer names the scope searched and the number of dependencies in it
- [ ] #4 Output headers say "usable here" only for names that meet the ownership rule of TASK-21.9
<!-- AC:END -->

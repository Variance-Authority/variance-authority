---
id: TASK-21.10
title: Every third-party answer carries its evidence
status: Done
assignee:
  - '@claude'
created_date: '2026-09-28 03:54'
updated_date: '2026-09-29 08:14'
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
- [x] #1 Each third-party hit names its declaring manifest, declaration kind and installed version, or says which of them could not be resolved
- [x] #2 Each hit says whether the owning area imports the package, with a stable count and one source site
- [x] #3 An empty third-party answer names the scope searched and the number of dependencies in it
- [x] #4 Output headers say "usable here" only for names that meet the ownership rule of TASK-21.9
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Lexicon v6 rows carry declaredAs (dependency/optional/peer/dev), a written-import count and the first site per owner; queries return manifest, declaredAs, imports, site and a scope (manifests read, distinct packages). Types-only packages take their version from the declarations. search and symbol print 'version · declared-as in manifest · imported N× (first file:line) / not imported', unresolved facts said as such. An empty third-party answer names the packages and manifests searched. 'usable from that start point' is only printed for a scoped question (21.9 rule); an unscoped one says 'offered by some manifest in this workspace'. Test: search-third-party.test.ts, dependency-lexicon.test.ts.
<!-- SECTION:FINAL_SUMMARY:END -->

---
id: TASK-21.8
title: Index public APIs of available third-party dependencies
status: Done
assignee:
  - '@akorzunov'
created_date: '2026-09-27 23:54'
updated_date: '2026-09-28 02:04'
labels: []
dependencies:
  - TASK-21.7
parent_task_id: TASK-21
ordinal: 39000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Build a separate Rust-maintained catalogue of every third-party dependency this checkout declares as available, whether or not source imports it. Resolve installed identities and public entrypoints from each owning package context. The source index supplies observed imports. Ask search and symbol query the catalogue alongside local help; graph-scoped search selects domain availability while orient remains compact.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The catalogue includes declared third-party dependencies across root and workspace manifests, including unimported solutions, and excludes installed transitive packages with no first-party declaration or import evidence.
- [x] #2 Each available dependency resolves from its owning package context and records installed runtime identity, version and public entrypoints when possible; unavailable resolution is explicit.
- [x] #3 Public names, signatures and JSDoc are indexed separately and can be queried without naming a source file.
- [x] #4 Ordinary variance index refreshes the catalogue without a source-file argument or repository source scan; unchanged installed API readings are reused and changed declarations refresh.
- [x] #5 Graph-scoped ask search joins local help and third-party availability for from and to paths while orient keeps its concise dependency graph; a fixture and this repository verify the split.
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Remove index --api and the API detail dump from orient. 2. Have ordinary index refresh the installed third-party catalogue in Rust from tracked manifests and source-index import evidence. 3. Resolve public entrypoints and declaration graphs, including separate type providers and export-equals namespaces, with digest-based reuse. 4. Query bounded third-party matches in Rust from ask search and symbol, using the existing source-graph closure for from and to. 5. Verify with multi-workspace fixtures and this checkout.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Native implementation and query are in packages/sense/native. The fixture proves an unimported direct dependency, an imported undeclared dependency, exclusion of an unused installed package, two installed versions from different workspaces, separate type providers, export-equals declarations, and declaration-only refresh with reuse. Self run indexed 213 package contexts and 3221 entrypoints in about 1.3 seconds cold and 1.1 seconds warm; ask search with from and to and ask symbol returned installed React APIs while orient stayed concise. Build, lint, check, measure and 13 focused tests pass. The full test run passed 599 files and failed 13 browser case files on hook timeouts, missing WebKit, and Storybook fixture expectations; the new fixture passed and the three index output expectations were fixed and rerun green.

Correction to the self-run count: 213 means distinct owning-manifest and external-dependency pairs, not 213 packages. The saved corpus has 53 owning manifests and 63 distinct external package names.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Replaced file-scoped dependency API indexing with a Rust-maintained catalogue refreshed by variance index. Ask search and symbol now query installed third-party APIs with workspace scope; orient remains concise. Verified by multi-workspace fixture, self indexing and querying, build, lint, check, measure and focused tests. The full suite still has unrelated browser case failures.
<!-- SECTION:FINAL_SUMMARY:END -->

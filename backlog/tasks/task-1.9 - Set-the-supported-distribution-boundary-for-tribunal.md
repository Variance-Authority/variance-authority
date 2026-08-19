---
id: TASK-1.9
title: Set the supported distribution boundary for tribunal
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10900
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The repository contains a tribunal package and deployment material, while the
current product story says compute, storage, and hosting are supplied by the
consumer and no hosted dashboard is part of the contract. The unresolved issue
is not whether a deployment happens to exist today; it is which distribution
boundary is authorized and which consumer path tribunal owns.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate tribunal's intended consumer, the source-only/BYO contract, deployment entry points, and package/release reachability
- [ ] #2 Confirm the boundary with a consumer-level install or deployment run, or record an explicit source-only decision that explains why deployment is out of scope
- [ ] #3 Fix the release/deployment path and its verification, or reconcile tribunal, README, package docs, and checkpoint around the authorized boundary
<!-- AC:END -->

---
id: TASK-1.10
title: Restore non-vacuous cross-platform verification
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Several verification paths are represented by markers rather than exercised
evidence: actual macOS/Linux portability fixtures, partition-pointer checks in
`doctor`, skipped workflow branches, and the Docker Linux verifier's FIXME
about checking the wrong commands and exiting before reading results. These
are separate from the passing local suite and can leave a green report without
proving the environments the project names.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate each marker and FIXME, identifying whether it is a real defect, an unavailable environment, or an intentional unrun boundary
- [ ] #2 Confirm the highest-risk paths on the named platform/container or with a reproducible substitute that exercises the same gate
- [ ] #3 Fix scripts, fixtures, workflow wiring, and markers where needed, or route each unavailable check to an explicit conditional boundary rather than a silent skip
<!-- AC:END -->

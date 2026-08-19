---
id: TASK-1.2
title: Reconcile wiringOf with the shipped page agents and report
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10200
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The DOM and React layers expose `wiringOf`, and the checkpoint says the
framework band carried through a real collection. The Playwright, route, and
Storybook page agents currently omit `wiringOf`, while no report carries a
remount finding. This may be an intentionally optional instrument or a broken
connection between the shipped collectors and the claimed framework evidence.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate every shipped collector call site, the wiring digest/report path, and the reason for the current omission
- [ ] #2 Confirm the intended contract with one real collection that can distinguish stable wiring from a remount, or record that the instrument is not a product path
- [ ] #3 Fix the collector/report connection and tests, or narrow the checkpoint and public claims to the verified optional boundary
<!-- AC:END -->

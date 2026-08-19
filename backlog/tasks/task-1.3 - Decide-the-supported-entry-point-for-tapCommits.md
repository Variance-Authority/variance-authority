---
id: TASK-1.3
title: Decide the supported entry point for tapCommits
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10300
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`packages/react` exports `tapCommits`, but no collector consumes it. Its
install-before-`react-dom` requirement is a real constraint for a collector
that arrives at an already-running page, so the unused export may be a safe
boundary rather than unfinished wiring. The project needs one explicit answer
before treating commit attribution as a supported capability.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate React load order, all collector entry points, and whether any supported integration can install the tap before react-dom
- [ ] #2 Confirm the answer with a focused real-page run or a recorded impossibility proof that names the late-attachment failure mode
- [ ] #3 Fix the safe integration point and coverage, or mark/deprecate the export and route the boundary through the owning README/spec/checkpoint
<!-- AC:END -->

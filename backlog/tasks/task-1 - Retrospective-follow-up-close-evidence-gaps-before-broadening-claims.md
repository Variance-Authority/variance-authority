---
id: TASK-1
title: 'Retrospective follow-up: close evidence gaps before broadening claims'
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The retrospective of `main` found a strong, tested semantic core but several
capabilities whose owners, consumers, or external evidence are incomplete.
Work each child through the same bounded loop: investigate the current owner
and rationale, confirm it with a focused run or an explicit product decision,
then fix the code, tests, task routing, or public claim. Do not broaden the
product boundary on the strength of an unconnected export, a synthetic corpus,
or a deployment that has not been exercised by its intended consumer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Every child has an evidence-backed investigation and an explicit confirmation result
- [ ] #2 Each confirmed gap is fixed, routed to its owning spec/decision, or recorded as an intentional boundary
- [ ] #3 The checkpoint, public claims, code markers, and verification output agree with the resulting boundary
<!-- AC:END -->

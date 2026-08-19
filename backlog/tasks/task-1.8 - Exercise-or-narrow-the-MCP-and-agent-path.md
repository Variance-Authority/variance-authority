---
id: TASK-1.8
title: Exercise or narrow the MCP and agent path
status: To Do
assignee: []
created_date: '2026-08-16'
labels: []
dependencies: []
parent_task_id: TASK-1
ordinal: 10800
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The MCP package has todo coverage for live rewritten report streams and a
real stdio client, and the project has not exercised a real agent/MCP consumer.
The local CLI path is tested, but the agent-facing path remains a claim about
an interface rather than evidence from its intended caller.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria

<!-- AC:BEGIN -->
- [ ] #1 Investigate the MCP transport, live report rewrite contract, stdio lifecycle, and the agent actions the project intends to support
- [ ] #2 Confirm the path with a real stdio client and a live report stream, or record that the supported boundary is local CLI only
- [ ] #3 Fix transport/report integration and tests, or narrow agent/MCP claims and remove any status prose that can outlive the code marker
<!-- AC:END -->

---
id: TASK-27
title: >-
  Keep the outputs pasted in docs/agent-cli.md true, and the page readable top
  to bottom
status: To Do
assignee: []
created_date: '2026-10-09 08:41'
updated_date: '2026-10-09 08:48'
labels:
  - docs
dependencies: []
documentation:
  - docs/agent-cli.md
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`docs/agent-cli.md` shows real `variance ask summary` and `variance ask adjudicate` output from `examples/agent-claim` (PR #264). Nothing re-checks that pasted text against the CLI, so a wording change in the CLI leaves the page wrong without a failing check. Separately, a cold reader of the whole page (the `content-flow` reviewer) loses the thread in the code-question sections ("Start with the code: no run needed") before reaching the finished-run section.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A check fails when an output block pasted in docs/agent-cli.md no longer matches what the CLI prints for examples/agent-claim
- [ ] #2 The content-flow reviewer, given the whole page cold with the reader "an engineer with a finished run" and the question "how do I go from the summary to adjudicating a claim", answers with the summary, claims-file and adjudicate steps in order and names no point where it lost the thread
<!-- AC:END -->

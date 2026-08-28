---
id: TASK-16
title: Make component holdings reachable from a browser run
status: To Do
assignee: []
created_date: '2026-08-27 22:22'
labels: []
dependencies: []
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`holdingOf` reads props, contexts and hook cells per component boundary, and `partingOf`/`explainParting` turn two snapshots carrying them into a named cause. Both are reachable today only from `@variance-authority/unit-test`'s `capture`, because the browser page agents in playwright-test, route-collector, storybook-collector and presentation pass `provenanceOf` and nothing else. A run against a real page therefore gets the deltas and none of the explanation, which is the case the feature exists for.

The blocker is not plumbing. Reading a holding suppresses inert-wrapper collapse (a wrapper rooting a boundary would take the holding with it), so a run that reads holdings produces a different `structureHash` for the same page than a run that does not. It cannot be defaulted on, and both sides of any comparison must be read the same way or every structural delta is an artifact of the setting. That needs a decision about where the setting lives, how a baseline records which way it was read, and what happens when the two sides disagree.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A collector configuration can turn holding reads on, and the page agents pass `holdingOf` when it is on
- [ ] #2 A snapshot records whether holdings were read, so a comparison can refuse two sides read differently rather than reporting the wrapper difference as a structural delta
- [ ] #3 The MCP tool surface can ask for a parting and gets `explainParting` output, not raw deltas
- [ ] #4 The `// FIXME:` in packages/core/src/rules/normalize/wrapper.ts about `wiring` being destroyed by the same collapse is either fixed with its own changeset or restated as a decision
<!-- AC:END -->

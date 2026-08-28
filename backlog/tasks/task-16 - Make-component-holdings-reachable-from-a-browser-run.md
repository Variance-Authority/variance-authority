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

**The divergence axis is already out from under that blocker and shipped.** Both renderings of a divergence come out of one run, off one collector, at one commit, so they are read the same way by construction and there is nothing to reconcile. Two readings landed with it and neither needs an adapter: boundaries are found from the owner chain rather than from `holding`, and the `inherited` rung reads the ancestor cascade out of `styleProvenance` — which is what makes an ancestor's `color` nameable on a browser run today. What holdings would add there is the props, context and hook-cell rungs above it.

What remains under the blocker is the two-revision axis: a parting between a baseline and a candidate, which is where two configs and two baselines have to agree about how they were read.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A collector configuration can turn holding reads on, and the page agents pass `holdingOf` when it is on
- [ ] #2 A snapshot records whether holdings were read, so a comparison can refuse two sides read differently rather than reporting the wrapper difference as a structural delta
- [ ] #3 The MCP tool surface can ask for a parting between two revisions and gets `explainParting` output, not raw deltas — the divergence half of this shipped, and `composition` prints the parting under each rendering
- [ ] #4 The `// FIXME:` in packages/core/src/rules/normalize/wrapper.ts about `wiring` being destroyed by the same collapse is either fixed with its own changeset or restated as a decision
<!-- AC:END -->

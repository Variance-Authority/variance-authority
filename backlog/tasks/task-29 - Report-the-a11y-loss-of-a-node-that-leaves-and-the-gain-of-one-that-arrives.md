---
id: TASK-29
title: 'Report the a11y loss of a node that leaves, and the gain of one that arrives'
status: To Do
assignee: []
created_date: '2026-10-13 10:33'
updated_date: '2026-10-13 10:37'
labels: []
dependencies: []
references:
  - 'https://github.com/Variance-Authority/variance-authority/pull/334'
ordinal: 58000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
`bandOf` in `packages/core/src/compare/band.ts` bands `node-removed` and `node-added` as `geometry` whatever the node carried. A checkbox simply removed, or two replacements by one author that `matchTrees` (`packages/core/src/compare/diff/match.ts`) leaves unpaired, therefore reports a lost `checkbox` role as `geometry`, and a project with `blocking: ['a11y']` does not stop on it. A lost role reads `a11y` only when the replacement is paired and `role-changed` is emitted.

A node that leaves or arrives carrying a role, an accessible name or ARIA state should also report that loss or gain in the `a11y` band, without inventing a pairing. How is open: for example an `a11y` delta beside the node delta, or a band derived from what the node carried. `bandOf` and `compareNodes` (`packages/core/src/compare/diff/compare-nodes.ts`) stay the one owner of banding.

The component hashes make the same choice on purpose: `bandsBetween` and `movedBandsBetween` (`packages/core/src/attribute/component-hash.ts`) band a component present on one side only as `geometry`. Say whether that rule follows the docket or stays, since a docket that bands the loss `a11y` while the digests say `geometry` widens the gap TASK-28 weighs.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A removed node that carried a role reports the role's loss in the `a11y` band on the docket, pinned by a test that fails on the code before the change
- [ ] #2 An added node that carries a role reports the gain in the `a11y` band, with a test
- [ ] #3 A removed or added node that carries no role, name or ARIA state reports no `a11y` delta
- [ ] #4 A replaced element that `matchTrees` pairs reports its role change once, not also as a removal and an addition
- [ ] #5 The task records whether a component present on one side only still bands `geometry` in `bandsBetween`, and why
- [ ] #6 Fixtures that asserted the old banding are amended, the band table in `packages/core/README.md` names `node-removed` and `node-added` with the new rule, and a changeset names it
<!-- AC:END -->

---
id: TASK-28
title: >-
  Decide a relaxed subject from the bands the two trees moved, when both are
  recorded
status: To Do
assignee: []
created_date: '2026-10-13 10:33'
updated_date: '2026-10-13 10:37'
labels: []
dependencies: []
references:
  - 'https://github.com/Variance-Authority/variance-authority/pull/334'
documentation:
  - docs/context/adr/0027-a-baseline-carries-what-its-document-said.md
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A relaxed subject (a `sensitivity` rule below strict) is decided by `relaxedVerdict` in `packages/observe/src/decide.ts` from the component hashes alone (`bandsBetween` in `packages/core/src/attribute/component-hash.ts`). The digests cannot say that a tag changed under a style. The semantic diff now pairs an element with the one its recorded author rendered in its place (`matchTrees` pass 3) and bands that pair's style deltas `geometry` (`bandOf(kind, { retagged })` in `packages/core/src/compare/band.ts`), but the digest path still lists `token` among the absorbed bands. So on a replaced element the record's `relaxed.bands` can name `token` where the docket says `geometry`. The verdict agrees at every level in `LEVELS` (`packages/core/src/judge/sensitivity.ts`); only the absorbed list differs.

A baseline now keeps its packed semantic snapshot, which `decide` unpacks, so both trees are often at hand when a relaxed subject is decided. Whether they, rather than the digests, should say which bands moved is a change to the sensitivity rule, not to pairing, and is undecided. Weigh how the two answers differ beyond a replaced element: a component present on one side only, texture, and profiles without layout. Also weigh whether the property the component-hash docstring (`packages/core/src/attribute/component-hash.ts`) holds survives: a subject relaxed to `layout` absorbs the same bands whether the run held two documents or two sidecars. There must stay one owner of which bands moved: a second implementation is a defect.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A decision is recorded, in an ADR (none owns the sensitivity rule today) or in the PR, saying whether a relaxed decision reads the two trees when both exist, and why
- [ ] #2 If the trees decide: on a replaced element the relaxed record's `bands` and the docket name the same bands, pinned by a test that fails on the code before the change
- [ ] #3 If the trees decide: a subject whose before or after side has no readable snapshot is still decided from the component hashes, with a test
- [ ] #4 If the trees decide: one function owns which bands moved between two trees, and both the relaxed path and the docket ask it
<!-- AC:END -->

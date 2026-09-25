---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance covering --since <ref> --against <record>` says which regions a change's tests moved

Two case indexes are compared region by region, and each region whose cases
moved is lost, hidden, thinned or gained. Each test file says how many regions
it now enters and no longer enters. The files the base branch changed after the
base was recorded are left out and named. `--cases last` makes the same
comparison against the cases the last run replaced. `caseMotion` in
`@variance-authority/sense/test-selection` is the comparison.

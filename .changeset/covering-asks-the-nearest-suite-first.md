---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`covering` asks the nearest suite first, and says when a record is older than the file

With more than one suite declared, `covering` answered in suite-name order, so
an e2e suite named `chromium` printed first and the unit answer came after
thousands of lines. Suites are now asked nearest kind first: unit, integration,
e2e, visual.

A file added after the commit a suite recorded at was folded into
`Not loaded by …`, which reads as *no test of that suite loads it*. That suite
now says the file did not exist at the commit its record was made at, and that
running the suite answers it. `existedAt(root, commit, path)` is exported from
`@variance-authority/sense` for the same question.

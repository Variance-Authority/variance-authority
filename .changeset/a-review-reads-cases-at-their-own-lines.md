---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`review --coverage` no longer lists a region twice, once at lines the change moved

A suite's record can hold its coverage rows at the tree's lines while its case
index still holds the lines of an earlier text. This happens when a run keeps no
case: every test file it selected was skipped, so it carries the index forward
and re-cuts only the coverage rows. `review --coverage` took such a suite as
having run the file as the tree holds it. It then listed every region a second
time, at its old lines and as run by no case, beside the same region at its
current lines and the cases that entered it. The warning, the "Where no case
ran" section and the graph all named the old lines.

A suite now answers for a changed file only when its case index stands at the
lines of its coverage rows, as well as at the tree's text. A suite whose index
stands elsewhere gives way to the suites that ran the file. When no other suite
did, it answers alone, as before.

`casesCutApart(coverageFile, modules)`, from `@variance-authority/sense/test-selection`,
names the files a record's case index cut at other lines than its coverage rows.

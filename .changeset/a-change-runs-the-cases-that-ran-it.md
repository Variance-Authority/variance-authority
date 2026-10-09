---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A selection skips the cases a change did not reach, under `VARIANCE_AUTHORITY_GRAIN=case`

A selected test file ran every case it declares, though the record knew which
of them entered the changed code. With `VARIANCE_AUTHORITY_GRAIN=case`, the
Jest and Vitest seams skip the cases of each selected file that entered none of
the changed regions. The worker marks them skipped through the runner's own
task modes, as `it.skip` would, so nothing reaches argv. The stderr line counts
them: `selected 2 of 340, skipping 31 cases in 2 of them`.

A file runs whole whenever the record cannot say which cases a change reached:
the test file changed, a reason other than a region selected it, the region ran
while its module loaded, or no recorded case entered it. A case that shares its
full name with a reached case runs too. A file run in part is recorded
incomplete, so the next selection runs it whole. File grain stays the default,
and any value other than `file` or `case` fails the run.

`SuiteSelection` gains `cases`, each test file run in part to the names of the
cases it may skip, and `variance`'s `selectSuite` takes `grain`.

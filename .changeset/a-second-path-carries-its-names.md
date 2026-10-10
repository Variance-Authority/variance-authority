---
'@variance-authority/sense': patch
---

A changed value reached through two importers selects the tests that read it on either path

A value change is charged to the tests that ran code reading the moved name. The
walk follows it from the declaring file to every file that imports it, under the
name each importer hands it on as. A file reached a second time was skipped, even
when the second path carried it under another name. So when `gauge.ts` imported
`bounds.ts` directly for `unit` and, through `ceiling.ts`, for `LIMIT` re-exported
as `ceiling`, a change to `LIMIT` never asked `gauge.ts` about `ceiling`, and a
test calling the function that returns it was left out. Now a file reached again
is asked about the names that path carries and no earlier one did. Each file is
still read at most once per name, so the walk costs what it did when every path
carries the same name.

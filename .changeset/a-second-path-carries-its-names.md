---
'@variance-authority/sense': patch
---

A changed value selects the tests that read it on every import path, its own file's included

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

The declaring file is now one of the files asked. A file that read its own value
through an import, such as `self.LIMIT` after `import * as self from './limits'`,
or `L` after importing `LIMIT as L` back through a barrel, was never charged for
that read. Now it is, and a test that loaded the file by an edge the graph lacks
is still named in `unseen`.

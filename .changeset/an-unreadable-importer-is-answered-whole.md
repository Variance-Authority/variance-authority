---
'@variance-authority/sense': patch
---

A changed value read through a file the parser cannot read selects the tests that loaded that file

When a change moves an exported value, selection reads each importer for where
it uses the value, and follows the importers that pass it on. An importer with
no coverage whose text cannot be read, such as a Flow `.js` file that
re-exports the value, used to pass nothing on. A test that read the value
through it was not selected, and was reported only as `unseen`, and only when
the declaring file had coverage. Now every test that loads such an importer is
selected, found by the file graph's walk over its importers, with a `reader`
reason naming the value, the declaring file and the importer. It is no longer
listed in `unseen`. A test that mocked the importer is left out. A suite that
declines the graph for files with no coverage (`unmeasured: 'nothing'`) still
selects nothing here.

---
'@variance-authority/sense': patch
---

A changed value read through a file the parser cannot read selects the tests that loaded that file

When a change moves an exported value, selection reads each importer for where
it uses the value, and follows the importers that pass it on. An importer with
no coverage row whose text does not parse, such as a Flow `.js` file that
re-exports the value, used to pass nothing on. A test that read the value
through it was not selected and was not reported either, unless the declaring
file had a row, and then only as `unseen`. An importer with a row in the same
place already selected every test that crossed it. Now an unreadable importer
with no row is answered the same way: every test that loaded it is selected,
found by the file graph's walk over its importers, with a `reader` reason
naming the value, the declaring file and the importer. A test selected this way
is no longer listed in `unseen`. A suite that declines the graph for files with
no row (`unmeasured: 'nothing'`) still selects nothing here, and the test stays
in `unseen`.

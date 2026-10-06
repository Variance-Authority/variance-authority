---
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill --file` says, under each import that loads what no case
entered, what the test file can do about it, by how far from the test file the
importer is. An import the test file writes is an error, with "delete the
import" when the file references none of it. An import a file the test file
imports writes is proposed as a `jest.mock` with a factory that stands
`jest.fn()` in for every value the module exports, and none where a case runs
what reads it, where the test file reads an export whose value the import
carries, or where what that file reads, what the module exports, or why it is
loaded, is not known. An import further away is a warning to fix it in its
importer. A reading names a function by its name, not its region's path. An
import cause carries `reach`: `test`, `subject` or `beyond`, and for a subject's import
`exports`; a load charge carries `carried`, the export the test file reads.

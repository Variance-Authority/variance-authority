---
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill --file` says, under each import that loads what no case
entered, what the test file can do about it, by how far from the test file the
importer is. An import the test file writes is an error, with "delete the
import" when the file references none of it. An import a file the test file
imports writes is proposed as a `jest.mock` with a factory that stands
`jest.fn()` in for every value the module exports, where that file reads none
of it or reads it only in functions no case ran, and the module's exports are
known. An import further away is a warning to fix it in its importer. A reading
names a function by its name, not its region's path. An import cause carries
`reach`: `test`, `subject` or `beyond`, and for a subject's import `exports`.

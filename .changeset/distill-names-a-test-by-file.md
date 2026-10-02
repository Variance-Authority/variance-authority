---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
---

`variance distill` finds a test by its file and title: `--file` takes any part
of the test file's path, and `--test` takes the recorded id, the exact title or
a part of it, in the Eyes archive or the execution index, whichever you have.
When more than one test fits, the command prints their ids. `distill()` takes
the same `file`, and `test` is optional when `file` names a file with one test.

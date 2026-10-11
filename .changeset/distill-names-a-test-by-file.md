---
'@variance-authority/cli': minor
'@variance-authority/distill': minor
---

`variance distill` finds a test by its file and title: `--file` takes the test
file's path in the checkout, and `--test` takes the recorded id or the whole
title, in the record's case index, and reads the case's journals by its id.
When more than one test fits, the command prints their ids. `distill()` takes
the same `file`, and `test` is optional when `file` names a file with one test.

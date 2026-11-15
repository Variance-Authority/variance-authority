---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/help': patch
---

`variance story --name` explains a test no story was recorded for from the
record every run keeps: each line of its body in the order first reached, with
its source, its time and its share of the test, and the functions it was the
first to run, grouped by package, a hook's apart. It says when the test file
changed since the record was written. A test with a story recorded still
prints the story, as does an ask that names a `--project`.

`ask slowest-tests` gives a statement's share of its case as `variance story`
does, from the statement's microseconds, and prints its time to the nearest
millisecond.

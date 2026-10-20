---
'@variance-authority/sense': patch
---

An edited test file is no longer selected again after it ran green

A test file you edited was selected on every run until the edit was recorded over a clean tree, and a commit of edits that had already run green selected them all once more. Selection now compares the text each test recorded for its own file and its declared setup files with the text the diff arrives at, and skips a test that already ran that text. `variance select` reads such a file as `none (the record was taken over this text)`.

The decision is per test: where two tests declare one setup file and only one of them ran the text there now, the other is selected alone. `testsGovernedBy` takes the digest each name arrives at as an optional third argument, leaves out a test whose row records it, and returns the names held only by such rows as `ranOver`.

A run records a test incomplete when its test file or a declared setup file was written while the run ran. The run reads those texts when it ends, so the text it would record may not be the one the test ran, and the next selection runs that test again rather than skip an edit nothing ran.

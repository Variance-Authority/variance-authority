---
'@variance-authority/sense': patch
---

An edited test file is no longer selected again after it ran green

A test file you edited was selected on every run until the edit was recorded over a clean tree, and a commit of edits that had already run green selected them all once more. Selection now compares the text each test recorded for its own file and its declared setup files with the text the diff arrives at, and skips a test that already ran that text. `variance select` reads such a file as `none (the record was taken over this text)`.

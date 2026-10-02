---
'@variance-authority/sense': patch
---

An `else if` transformed by esbuild is recorded on the line it was written on.
esbuild opens the `else` line with the origin of the `if` above it and gives the
nested `if` none, so the `else` region was recorded from the line above, held
the nested region strictly inside it, and a line query on the `else if` line
answered without the tests that ran the `else`. The same module loaded through
its build was recorded on the right line, so the answer changed with which of
the two a run transformed last.

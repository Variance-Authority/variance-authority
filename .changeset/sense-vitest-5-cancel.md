---
'@variance-authority/sense': patch
---

A Vitest 5 run cancelled part-way through a file no longer records that file whole

When `--bail` or an interrupted watch run cancels Vitest 5, the tests it had not
reached are marked skipped in their results, not only in their modes. With a
command-line `--reporter` in place of the seam's, those skips were counted as
the file's own, so the file was recorded whole and lost the reach of the tests
the cancel cut. A skip in a run the runner may have cut is no longer an outcome,
wherever Vitest wrote it.

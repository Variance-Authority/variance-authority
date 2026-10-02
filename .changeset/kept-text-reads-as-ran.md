---
'@variance-authority/sense': patch
---

A file whose tests already ran its text says so

When your last run was recorded over uncommitted edits and the diff ends at the
text those tests ran, the selector reads that file as
`none (the recorded tests already ran this text)`. `none — the runtime text is
equal` is printed only when the parser compared both texts and found them equal.
The JSON reading for the first case is `none` with `kept: true`.

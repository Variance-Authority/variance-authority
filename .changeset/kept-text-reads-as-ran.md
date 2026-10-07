---
'@variance-authority/sense': patch
---

A file whose record was taken over its current text says so

When your last run was recorded over uncommitted edits and the diff ends at the
text that run was taken over, the selector reads that file as
`none (the record was taken over this text)`. The first such line adds that a
test recorded over an earlier text of an edited region is not skipped: a run of
one test file leaves every other test that ran the edited code incomplete, and
it is selected as such. `none — the runtime text is equal` is printed only when
the parser compared both texts and found them equal. The JSON reading for the
first case is `none` with `kept: true`.

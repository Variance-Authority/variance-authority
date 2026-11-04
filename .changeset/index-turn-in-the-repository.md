---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance index` no longer keeps its lock in the temporary directory, so a
`$TMPDIR/variance-authority-<uid>` that others may write in stops it no more, and
no `TMPDIR` needs setting. The lock is `.work/index-turn` in the primary
checkout's cache, with `.work/index-turn.holder` beside it: the checkouts of one
repository index one at a time, whatever cache each has, and two repositories may
index at once, even in one cache. A worktree of a bare or `--separate-git-dir`
repository has no primary checkout to find, so it waits for none. A file system that refuses the lock no longer stops the index,
which runs and says why, and an addon that did not load is reported with what to
do rather than as a defect. `indexTurnPath(root)` now takes the checkout,
`inIndexTurn` takes a fourth callback told of that refusal, and `refusalAt` reads
what the file system refused out of what the addon said. The old directory is
left where it is, and nothing reads it.

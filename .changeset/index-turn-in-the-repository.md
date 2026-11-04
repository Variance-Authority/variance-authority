---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance index` no longer keeps its lock in the temporary directory, so a
`$TMPDIR/variance-authority-<uid>` that others may write in stops it no more, and
no `TMPDIR` needs setting. The lock is `.work/index-turn` in the repository's
cache: the checkouts of one repository index one at a time, and two repositories
may index at once. A file system that refuses the lock no longer stops the index,
which runs and prints one line saying so. `indexTurnPath(root)` now takes the
checkout, and `inIndexTurn` takes a fourth callback told of that refusal. The old
directory is left where it is, and nothing reads it.

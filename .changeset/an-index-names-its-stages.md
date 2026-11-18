---
'@variance-authority/sense': patch
---

With `VARIANCE_AUTHORITY_INDEX_STAGES=1` set, a native index run writes one
line per stage to stderr — listing, open, walk, records, encode and write — each
with its wall time and the process's peak resident memory. The walk's line adds
the thread time spent reading, parsing and resolving, summed over every core.
The listing's line names its parts in a fixed order — head, held, tree,
worktree, compare, hash-object, merge, seeds and assemble, and ls-tree or git
status when git does the work — each with its wall time. Unset, nothing is
timed or printed.

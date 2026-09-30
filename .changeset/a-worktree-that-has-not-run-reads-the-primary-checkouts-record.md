---
"@variance-authority/cli": patch
---

A git worktree that has not recorded reads the primary checkout's record

In a worktree whose own cache layer holds no record, `variance select`, `covering`, `coverage`, `review`, `journeys` and `ask orient` read the record, and the case index beside it, from the primary checkout's layer. For a suite with `carry: share`, `select` says so: `record of "<suite>": read from the primary checkout, because this worktree has recorded none of its own; kept at <path>; the mainline's is read only when neither has one`. The first test run in the worktree copies the primary checkout's record, and the case index beside it, into the worktree's own layer and records on top of the copy, so the worktree's case index starts with the cases of the whole suite. The runs log is the worktree's own, because it says where this checkout's change starts, so `review` in a worktree that has not run asks for `--since <ref>` rather than starting where the primary checkout's runs did. `variance journeys`, given shard snapshots, merges them into the worktree's own layer, and the first such merge starts from the same copy.

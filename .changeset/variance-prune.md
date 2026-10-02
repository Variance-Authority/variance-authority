---
"@variance-authority/cli": minor
---

`variance prune` removes the cache entries whose checkout, worktree, process or
commit is gone, now, and prints what it freed. It reads no project
configuration, so a repository that only runs its test suites can keep its
cache bounded in a CI cleanup step or a scheduled job.

`variance doctor --prune` is removed; `variance prune` does what it did.
`variance doctor` still prints what the next prune removes.

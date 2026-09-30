---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

One `variance index` works at a time on a machine

The update and the follow-ups of `variance index` each use every core, so two checkouts indexing at once, for example a repository and one of its git worktrees, take turns. The second waits for the first, and prints once on stderr which process it waits for and which checkout that process indexes:

```text
waiting for process 48213, which is indexing /home/you/other-checkout: one index at a time uses this machine's cores
```

The update and the follow-ups each take the turn separately, so a short update in one checkout does not wait for the follow-ups of another. The turn is an operating-system file lock at `<temporary directory>/variance-authority-<user id>/index-turn`: a process that crashes lets it go, and two users on one machine do not wait for each other. `variance index` stops with an error that names that directory when it is a link, belongs to another user, or others can write in it; remove it, or set `TMPDIR` to a directory of your own. `@variance-authority/sense` exports `inIndexTurn`, which runs a function in the turn, `indexTurnPath` and the `IndexTurnHolder` type.

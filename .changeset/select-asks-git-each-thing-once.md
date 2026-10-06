---
"@variance-authority/cli": patch
"@variance-authority/sense": minor
---

`variance select` starts fewer git processes and waits on fewer of them in
turn:

- Where the clone keeps its shallow list is asked once per run, not once per
  distance counted.
- A record made at the merge base is zero commits away, and counting that
  starts no git process.
- The two directions of a distance are counted at once, and alongside the
  shallow-list lookup.
- Whether each commit this checkout ran tests at is on the branch is asked
  once per commit, and all of them at once.
- The merge base with the mainline is asked once, not again for each distance
  measured from it.
- The top of the checkout is asked once for every diff and commit read from it.
- The changed files and the untracked ones are listed at once, and the
  untracked ones diffed a few at a time.
- Every changed `package.json`, and the lockfile at each commit a group of
  tests last ran at, is read by one `git cat-file --batch`, not a `git show`
  apiece.
- `textAtRecording` reads the paths a jump ahead left unasked in one more
  window, not a process apiece, and asks whether the checkout is a partial
  clone once rather than for each window that answers a path missing.
- `repositoryRoot` answers a directory holding `.git` without starting git,
  unless `GIT_DIR` or `GIT_WORK_TREE` is set.

`@variance-authority/sense` exports `textsAt`, which reads paths at several
commits from one `git cat-file --batch`.

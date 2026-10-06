---
"@variance-authority/cli": patch
"@variance-authority/sense": patch
---

`variance select` starts fewer git processes and waits on fewer of them in
turn:

- Where the clone keeps its shallow list is asked once per run, not once per
  distance counted.
- A record made at the merge base is zero commits away, and counting that
  starts no git process.
- The two directions of a distance are counted at once.
- Whether each commit this checkout ran tests at is on the branch is asked
  once per commit, and all of them at once.
- Every changed `package.json`, and the lockfile, is read at the merge base
  by one `git cat-file --batch`, not a `git show` apiece.
- `textAtRecording` reads the paths a jump ahead left unasked in one more
  window, not a process apiece.

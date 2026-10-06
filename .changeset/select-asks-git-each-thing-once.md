---
"@variance-authority/cli": patch
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

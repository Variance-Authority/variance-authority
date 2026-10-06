---
'@variance-authority/sense': patch
---

`textAtRecording` reads the paths a caller asks about outside the set it named without starting a git process for each one. From the second such path at a commit, the commit's tree is listed once, and a path whose bytes on disk hash to the commit's blob is read from disk. Any other path is still read from git. The window over the named set is not moved by an outside path, so the named paths keep being read in batches. On this repository, `variance select --suite unit` started 222 fewer git processes and took 1.40 s instead of 3.08 s. The texts it returns are unchanged.

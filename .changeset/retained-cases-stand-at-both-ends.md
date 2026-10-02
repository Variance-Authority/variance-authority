---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A region that a retained recording still reaches no longer reads as having lost every case

When only some test files ran at a commit, `variance review` and `variance covering --cases last` compared the cases that ran with the cases they replaced, and left the rest of the record out. A region that the files which ran stopped reaching read as `lost`, and the review said "Lost every case against the base", even when test files that did not run again still reached it through their earlier recordings. A region those files reached all along read as `gained` once a file that ran reached it too.

The cases of test files that no run at the commit ran, which kept their earlier recordings, now count at both ends. A case a run at the commit recorded never does. A region they reach keeps them, so it reads as `thinned` when one case is left, and does not move otherwise. Each test file's own reach is still reported. `caseMotion` takes these cases as `retained`.

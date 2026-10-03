---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A region that a test file which did not run still reaches no longer reads as having lost every case

When only some test files ran at a commit, `variance review` and `variance covering --cases last` compared only the cases of the files that ran. Two kinds of region were reported wrongly. A region the files that ran stopped reaching read as `lost`, and the review said "Lost every case against the base", though test files that did not run still reached it. A region those other files had reached all along read as `gained` as soon as a file that ran reached it too.

The cases of test files that did not run at the commit keep their earlier recordings, and they now count at both ends of the comparison. A region they reach keeps them: it reads as `thinned` when only one case is left, and as unchanged otherwise. A case recorded by any run at the commit is not counted this way. Each test file's own reach is still reported. `caseMotion` takes these cases as `retained`.

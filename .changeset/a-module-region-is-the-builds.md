---
'@variance-authority/sense': patch
---

A module two builds cut apart no longer loses the cases of tests that did not run

A run that loads a module without running its tests still records the module's
regions, and the cases the index held for those tests are laid onto them.
Before they land, the index checks that its lines agree with the ones the run
recorded, so that cases recorded over an older text are not placed by address.
The module's own region was one of those lines, and it starts where the build
that cut it starts the module: line 1 from the source, the first kept statement
from a build. When the two cuts also kept a different set of a function's
awaits, the check read the module as cut from another text and dropped every
held case on it. The next review reported each region those tests entered as
`Lost every case`, in a file the pull request did not touch. The module's own
region is now left out of that check: the held cases land by address, and the
cases a review compares against stand on the module lines the run recorded.

---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`variance select --execution` runs every test `variance covering --line` names for a changed line

A journey file selected the cases that entered the innermost region holding a
changed line, and nothing else. A line that opens a region carries the text of
the region around it, so a change to the condition in `if (ready) {` skipped
every case that evaluated `ready` and never took the branch, while `variance
covering --line` named those cases for the same line. Each changed line is now
charged as `covering --line` and file-level `select` charge it: the innermost
region, the region around it when the line opens one, and the `else` nobody
wrote on the brace that closes a branch. `narrowByJourneys` and
`selectJourneyFile` give the same answer, with the addon and without it.

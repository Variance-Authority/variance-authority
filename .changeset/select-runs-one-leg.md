---
"@variance-authority/cli": minor
---

`variance select --at-distance <hops>` cuts the selection to one leg: the
selected test files that many imports from the change. The selected files
outside the leg join the skip list, so `0-2` and then `3-` run every selected file in one of the two.

A leg is still a skip list. A selection that declines to narrow skips nothing
in any leg, and a test the change did not enter and the record never saw whole
(new, or recorded incomplete) runs in every leg. stderr names how many selected
files the leg left and the command that runs them;
`--format json` gives the leg as `leg` and those files as `left`. A leg over a
journey file is refused, because a journey file records no imports to count
hops by.

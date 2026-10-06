---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance select --at-distance <hops>` cuts the selection to one leg: the
selected test files that many imports from the change. The selected files
outside the leg join the skip list, so `0-2` and then `3-` run every selected file in one of the two.

A leg is still a skip list. A selection that declines to narrow skips nothing
in any leg. A test the change did not enter and the record holds incomplete,
such as a file whose every case skipped, runs only in the leg that reaches the
end, as an unplaced test does; a test new since the recording is named nowhere,
so it runs in every leg. The execution narrowing names the incomplete tests as
`incomplete`. stderr counts the tests the
change entered at each hop count, and names how many selected files the leg
left and the command that runs them. `--format json` gives the leg as `leg`,
those files as `left`, and each entered test's hops, bearing and, where none
was measured, the reason as `distances`. A leg over a
journey file is refused, because a journey file records no imports to count
hops by.

---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance select` reads a journey file against a change you hand in

`variance select --execution journeys.bin` names the test files a change can
skip, read off the journey file `journeys finalize` or `journeys stitch` wrote.
The change comes from `--diff <patch>`, from `--diff -` on stdin, or from
`git diff` against `--since`. A patch with hunks selects the cases that entered
the innermost function holding each changed line. A case's crossings into a
module it mocks do not select it.

The reading happens in the native addon: `selectJourneyFile` answers a stitched
file of hundreds of millions of crossings in milliseconds, where decoding it in
JavaScript ran out of heap. `projectJourneyFile` returns only the regions a
change lands on, and `variance covering --execution` reads through it.

`variance covering --since <ref> --execution <journey-file>` diffs from the ref
you give. It used to diff from the commit of the recorded snapshot, which a
journey file does not have.

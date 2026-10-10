---
'@variance-authority/sense': minor
---

A case records the test line that reached each region

Under the Vitest, Jest and Rstest seams every case now records, for each
region it crossed, the line of the test statement that first reached it, and
whether that statement was the case's own or a hook's. The seam's transform
puts a call in front of each statement of a test or hook body; the call stores
the case's log length beside the line and reads nothing. The lines add 2.2% to
this repository's record and 2.4% to MUI's, and the suite's duration stays
inside its run-to-run spread on both. The transform returns a source map back
to the file you wrote. Pass `cadence: false` to leave test files as you wrote them and
write no lines.

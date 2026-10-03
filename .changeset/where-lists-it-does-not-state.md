---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`covering --where` narrows the cases listed, not the state

`variance covering --where` reads the state of a line, a function, a range of
the file or a changed region over every case that covered it, and lists only
the cases that said what was asked. A line three cases ran no longer reads
`alone`, or *the only case that could have*, because `--where` kept one of
them; a region a stopped case could have reached stays a hole when `--where`
leaves that case out. `stopped` names every case that could have reached it and
stopped first, since it is the evidence for the state. In the whole-file text, a
range none of the kept cases covered says so rather than that no named test
covered it.

`formatCoveringChange` takes an optional `state` on each region and words the
region from it: a region only an unlisted case ran reads *covered only by cases
not listed here*, not as a hole, and is not counted as nothing covered.

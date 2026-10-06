---
'@variance-authority/sense': patch
---

Another build of an unedited module no longer sends its tests back to run

A module your suite loads both as source and as its package's built output is
recorded once, under the source's path, but each build cut its regions with
digests of its own text. Layering a run that loaded one build over a record
that held the other read every region as edited and marked every carried test
that crossed them incomplete, so the next selection ran them all: one test file
layered over a full record of this repository's unit suite sent half of the
suite's files back. A region now counts as edited only when the module's source text
changed, and a run layered over the other build keeps the carried tests whole.

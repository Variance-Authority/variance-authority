---
'@variance-authority/cli': patch
---

`variance index --wait`, and `variance index` in CI, now make the code map, the journeys, the dependency lexicon and the questions in the same process of their own a workstation's `index` starts, and wait for it to end, rather than making them in the process that walked the source index. Their memory is no longer added to what the walk holds: on a cold run over a checkout of about 200,000 files, on an M4 Max with 64 GB and Node 24, the walking process's peak resident memory fell from about 2.3 GB to about 1.8 GB. The run takes about a second and a half longer, because that process brings the index up to date before it starts. The lines printed and the exit are the same; that process's lines are also written to the log beside the index, and its progress goes to stderr as it comes.

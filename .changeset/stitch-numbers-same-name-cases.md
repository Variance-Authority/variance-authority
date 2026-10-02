---
"@variance-authority/sense": patch
---

Stitched shards keep two cases that share a name apart. A shard that ran only the second of them numbered it as the first, so the stitch joined them and the first case took the second's regions and preconditions. Each shard artifact now carries the runner's id for each case. The stitch joins cases by that id and numbers the union as one fold over every shard would.

A fold now refuses a file where a repeated name would be numbered onto a case literally named that way, such as a second `pays` and a case named `pays#1`. The error names the file and both names.

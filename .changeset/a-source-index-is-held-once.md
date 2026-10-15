---
'@variance-authority/sense': patch
---

Reading the source index holds each file's facts once

The source index is a base and a working layer over it, and reading it decoded
every layer in full and kept them all, though a later layer's row is the only
one ever answered. An update that read every file again, as one does after a
change to how imports resolve, left a working layer that puts every key again,
and every reader of the index then held the repository's graph twice until the
index was next readied. On a repository of 450,000 files that was 4.4 GB of
heap against 2.2 GB, and `variance distill` ran out of memory at Node's default
heap.

Each layer is now decoded newest first, and a row a later layer already puts or
deletes is not decoded at all, so a reader holds what it would after readying.

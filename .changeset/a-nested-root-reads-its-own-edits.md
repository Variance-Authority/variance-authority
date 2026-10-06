---
'@variance-authority/sense': patch
---

A scan root below the top of its checkout reads the edits under it

`git status --porcelain` and `git hash-object --stdin-paths` both spell paths
from the top of the checkout, whatever directory they run in. `gitDigests`
keyed its map from the scan root and passed both sides through unchanged, so
for a root such as `packages/app` an edited file kept its committed digest, a
deleted or renamed-away file kept a digest for bytes that are gone, and an
untracked file got none. A known-change list from such a root failed to hash at
all. Each path git reports is cut to the scan root, one outside it is dropped,
and each path handed to `hash-object` is spelled from the top again, so every
digest under a nested root names the bytes on disk.

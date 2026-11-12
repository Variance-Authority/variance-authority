---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

A merge queue's group of one now skips what its pull request already ran. `variance select --tested` skips every test file when HEAD's clean tree is the tree the tested commit ran, where it used to decline a pull request already up to date with the mainline. `variance shards --tested` counts shards from the same selection, and the runner seam reads `VARIANCE_AUTHORITY_TESTED` beside `VARIANCE_AUTHORITY_SINCE`.

---
'@variance-authority/sense': patch
---

The source index now reads nothing again when it is entered from somewhere other than where it was written. That covers a subdirectory, a worktree's subdirectory and a copy of the checkout. A new index starts from the nearest one in the cache that holds a chain. A file whose record misses is then built from the parse the cache already holds for the same bytes. A reader that races a writer reads again instead of reporting the index as damaged.

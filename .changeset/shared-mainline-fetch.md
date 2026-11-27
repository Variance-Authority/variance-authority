---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A worktree's fetch of the mainline's record keeps it in the primary checkout's
cache, so every other checkout of the repository reads it, and removing the
worktree keeps it. A worktree that cannot write there keeps it in its own, and
a record a run handed on stays in the checkout that received it. A worktree
stands on the record it fetched until it fetches again, a fetch at an older
merge base never moves the record a fresh worktree reads backwards, and a
record another checkout kept is never written over.

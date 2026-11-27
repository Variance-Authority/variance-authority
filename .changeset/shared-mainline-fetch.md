---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A worktree's fetch of the mainline's record keeps it in the primary checkout's
cache, so every other checkout of the repository reads it, and removing the
worktree keeps it. Each checkout reads the nearest kept record its `HEAD`
contains, not the newest one on the machine, so a newer fetch elsewhere never
hands it a record of commits it lacks. A worktree that cannot write there keeps
it in its own, and a record a run handed on stays in the checkout that
received it.

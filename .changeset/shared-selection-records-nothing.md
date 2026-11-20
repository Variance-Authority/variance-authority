---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

`withTestSelection` takes `record: false` on Vitest: the run selects and places its files from the record as a recorded run would, and instruments, writes and lands nothing, so a second configuration, such as one that shares modules between files, runs the same selection without a second record of it. A file whose cases the selection cuts runs whole.

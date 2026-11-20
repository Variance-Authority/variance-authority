---
'@variance-authority/sense': minor
'@variance-authority/cli': patch
---

`withTestSelection` takes `record: false` on Vitest: the run selects and places its files from the record as a recorded run would, shuffles them and names the seed, and writes nothing, so a second configuration, such as one that keeps modules apart per test, runs the same selection without a second record of it.

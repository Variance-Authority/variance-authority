---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance doctor` names each suite the root `variance.config.json` declares, with its kind, and says whether a run has recorded it: this checkout's own record, the mainline's as last fetched, or the primary checkout's, with the file. A suite no run has recorded says what writes its first record. The exit code does not change, and nothing is fetched. `@variance-authority/sense/test-selection` exports `nearestRecord`, which says whose record a reader opens.

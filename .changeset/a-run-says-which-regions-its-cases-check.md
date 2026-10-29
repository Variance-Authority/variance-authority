---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance covering --file <path> --checked -- <command>` says which regions of a file the cases that entered them would notice gone. It runs the command once, then once per region a case entered with that region left out, and each of those runs runs only the cases that entered the region. Sense reads the region to leave out from `VARIANCE_AUTHORITY_FAULT=<path>#<ordinal>`, under Vitest and Jest, and records such a run only into the absolute `VARIANCE_AUTHORITY_CACHE` its caller set.

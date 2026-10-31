---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A leg read from `VARIANCE_AUTHORITY_AT_DISTANCE` names that variable in its notes. A test left for another leg now reads "the same run with `VARIANCE_AUTHORITY_AT_DISTANCE=2-` runs them", where it used to point to a `--at-distance` flag the run had no command line for.

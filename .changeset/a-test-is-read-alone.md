---
"@variance-authority/cli": minor
"@variance-authority/sense": minor
---

`variance covering --cases last|<test file>` answers from the chosen cases instead of the whole suite

`last` is the run that wrote the case index last. A test file is every case the
index holds for it. The answer starts by saying which cases it was read from,
and `--format json` names them under `scope`. `caseLayerFiles` in `@variance-authority/sense/test-selection` names
the files beside the index that record the last run and what that run replaced.

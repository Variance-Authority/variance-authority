---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance covering` no longer reads a case precondition against a `names.axes` axis. `--where` filters by what a case recorded and nothing else: a case that recorded nothing for a name is not read at the axis's base, a value the axis does not list is not reported, no twin is printed, and the JSON answer has no `twins` and no `where.outside`. `covering` no longer reads `names` from `variance.config.json`. `@variance-authority/sense/test-selection` no longer exports `caseTwins`, `outsideVocabulary`, `CaseTwin`, `OutsideVocabulary` or `CoveringCaseNote`, `formatCoveringChange` takes no note, and `heldValues` takes no grammar.

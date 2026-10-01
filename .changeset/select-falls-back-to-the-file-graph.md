---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`variance select` now asks the file graph when there is no execution journal, or the journal holds no whole observation of any test file. The walk is the one `variance reach --since` already makes. It walks from the journal's commit or from `--since`, and skips the files nothing imports that the walk did not reach. It answers only for an undeclared suite or one declared `unit`; an `integration`, `e2e` or `visual` suite still skips nothing without its record, and stderr says why. A test file that imports a package the lockfile moved stays in the run. A change that reaches a runner's config or setup module skips nothing, and neither does a lockfile that cannot be compared. `@variance-authority/sense` exports `isHarnessLike`, which names those files.

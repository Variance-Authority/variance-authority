---
'@variance-authority/cli': minor
'@variance-authority/core': minor
'@variance-authority/sense': minor
---

A bumped package and a moved manifest are read as the repository files they
change, once, before anything else is asked. `beyondReach` in
`@variance-authority/core/relate` walks a bump through the install to the first
files whose runtime imports load it, and stops there: a test that entered
anything further along evaluated that file on the way. A moved manifest becomes
every file beside it. `variance select`, `variance reach` and `variance run
--since` hand those files on as changed whole, so the suite's `before` and the
record answer for them as they do for an edited file.

`before` now holds files alone. A bump of a package your setup imports runs the
whole suite and names the setup file, not the package. `changedBefore` takes the
changed files only, and `BeforeReach.packages` is gone.

The `packages` option of `narrowByJourneys`, `narrowByExecution` and
`selectJourneyFile` is removed: pass the files `beyondReach` returns, each with
no line ranges.

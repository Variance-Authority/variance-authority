---
'@variance-authority/cli': patch
'@variance-authority/playwright-test': patch
'@variance-authority/sense': patch
---

Printed messages say what was recorded

A Playwright test's precondition line reads `ran under network=mocked` instead of
`arranged network=mocked`, and `no preconditions recorded` instead of `nothing
arranged`. With `varianceExecution` off it reads `so no variancePrecondition call
was recorded`. `variance review` prints `nothing records where this change
starts`, `variance journey` prints that the execution journal `has no entry for
this run’s subjects`, and the Vitest selection reason reads `worker reported
which files passed`.

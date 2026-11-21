---
'@variance-authority/playwright-test': minor
---

A Playwright test declares its check with `checked(id, fn)`, which `@variance-authority/playwright-test` now re-exports, as a case under any runner does; the `variance:check` annotation and the step of the same title are no longer read, and the run's scope — projects, `grep`, shard — is no longer recorded. A retry that runs in a worker driving no page still records how it ended and the checks it entered.

---
'@variance-authority/event': minor
'@variance-authority/sense': minor
'@variance-authority/cli': minor
'@variance-authority/distill': patch
---

A case records what the code under test read, beside what the test said. `varianceBreadcrumb(dimension, key, value)` from `@variance-authority/event` returns its value and, under a Vitest run in Node recorded with `@variance-authority/sense`, lays `dimension:key` and the value on the case that made the read; a read made while the test file loads lands on every case of the file. `variancePrecondition` now takes a dimension and a record, `variancePrecondition('flags', { discount: true })`, which records `flags:discount`, and holds any value JSON can hold; the one-name form and the `PreconditionValue` type are gone. `variance covering` prints `read flags:discount=false said true` beside each case and takes `--read <name>[=<value>]` to keep the cases by what the code read. `variance review` splits each changed region's cases by what they read, `flags:express read false by 1, true by 1, not by 6`, and `review.json` gives each case its `reads`. The review handover's breadcrumbs are now called pointers. `@variance-authority/distill` reads the new recorded form.

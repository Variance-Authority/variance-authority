---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A run that names no suite now records into the only declared suite, as
`variance covering` already reads it, and a reader that names none opens it.
Among several declared suites both still stop. `onlySuite` is exported from
`@variance-authority/sense/test-selection` for readers of their own.

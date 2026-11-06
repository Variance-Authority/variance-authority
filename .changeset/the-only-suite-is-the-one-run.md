---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

A run that names no suite now records into the only declared suite, as
`variance covering` already reads it. Among several declared suites it still
stops before the run starts.

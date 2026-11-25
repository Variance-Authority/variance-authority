---
'@variance-authority/sense': minor
'@variance-authority/mcp': minor
'@variance-authority/cli': minor
---

`variance ask ran --story` says when each step of a live execution ran

A head started with `VARIANCE_AUTHORITY_STORY=1` stamps each step with its
machine's clock. The execution's first row says when it began and how long it
took, and each step says how far into it the step ran, the time to the next
recorded step and that time's share of the whole. Every head of an execution,
and every later telling of it, is placed from the same beginning. The time
includes code the build put no probe in and waiting; it is not the function's
own time. Two executions whose steps differ only in time still compare equal.
A test's story has no times.

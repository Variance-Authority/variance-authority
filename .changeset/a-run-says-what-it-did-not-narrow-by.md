---
'@variance-authority/report': minor
'@variance-authority/cli': minor
'@variance-authority/mcp': minor
---

Carry the narrowing coordinate in the report, and print it in the summary header.

A `RunReport` now holds `narrowing`: the ref the run was told to observe from,
and where the recorded execution index stands — the commit it was written at and
how many files the working tree differs from it by. A run that narrowed nothing
carries the second half alone, so the coordinate is present whether or not it was
spent.

`variance_summary` prints it. Narrowing is an option and stays one; what this
refuses is the state where an agent works against a suite for weeks without ever
learning that an index is on disk and that the distance from it is a number. The
line names the commit and spells out the `variance run --since` that would use
it, and is omitted when there is no index, no position, or no distance.

`run` takes the coordinate as `index` and acts on it for nothing else.
`narrowingFor` resolves `since`, `against` and `index` together, so a caller
assembling a run reaches one call rather than three.

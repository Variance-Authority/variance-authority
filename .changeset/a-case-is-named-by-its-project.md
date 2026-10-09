---
'@variance-authority/sense': patch
---

A case run by a named Vitest project carries the project's name in its id

A test file matched by two Vitest projects runs once under each, and the case
index numbered the second copy, so `variance covering` listed
`greets by name [test/greet.case.ts > greets by name#1]` with nothing to say
which project the `#1` was. The index now carries the project name Vitest
reported for each case and spells the case by it, as Vitest prints it:
`|compiled| test/greet.case.ts > greets by name`. The name is the case's own,
so a run filtered with `--project`, or a shard, gives a case the same id a full
run does. A repeated name inside one project is still numbered.

When you upgrade: every case of a Vitest project your config names, including
a single project with `test.name` set, changes id once, on the first record
after upgrading, and history joined by id restarts for those cases. Cases of
unnamed projects keep their ids.

---
'@variance-authority/sense': patch
---

A case two Vitest projects both ran is named by the project that ran each copy

A test file matched by two Vitest projects runs once under each, and the case
index numbered the second copy, so `variance covering` listed
`greets by name [test/greet.case.ts > greets by name#1]` with nothing to say
which project the `#1` was. The index now carries the project name Vitest
reported for each case and spells every copy by it, as Vitest prints it:
`|compiled| test/greet.case.ts > greets by name`. A case only one project ran
keeps its plain id, and a repeated name inside one project is still numbered.
The ids of such cases change once, on the first record after upgrading.

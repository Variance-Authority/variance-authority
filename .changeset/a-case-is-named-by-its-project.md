---
'@variance-authority/sense': patch
'@variance-authority/playwright-test': patch
---

A case run by a named project carries the project's name in its id

A test file run by two projects — two Vitest projects, two Jest `projects`, two
Playwright projects — runs once under each, and the case index numbered the
second copy, so `variance covering` listed
`greets by name [test/greet.case.ts > greets by name#1]` with nothing to say
which project the `#1` was. The index now carries the project each case ran
under and spells the case by it, as Vitest prints it:
`|compiled| test/greet.case.ts > greets by name`. The name is the case's own,
so a run filtered to one project (`--project`, `--selectProjects`), or a shard,
gives a case the same id a full run does. A repeated name inside one project is
still numbered.

The project's name is the one the runner gives it: Vitest's `test.name`, its
`package.json` name or its directory, and an inline project without one by its
place in the list; Jest's `displayName`; Playwright's project `name`. A Jest
run whose projects share a test file also records that file once, rather than
failing to write the record.

When you upgrade: every case of a named project changes id once, on the first
record after upgrading, and history joined by id restarts for those cases.
Reordering an unnamed inline Vitest project list renames its cases. A project
without a name keeps the plain coordinate, and so does every Rstest case.

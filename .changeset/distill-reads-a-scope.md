---
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill` with neither `--test` nor `--file` reads every test file of
the record, or with `--from <dir>` every one under a folder or a package, and
ranks each import by the lines it loads for nothing, counted once in every test
file it reaches. With no `--suite`, it reads every declared suite and names one
that has not recorded. The file graph is read once, and only when some test file
loaded a module no case of it entered.

`@variance-authority/distill` exports `distillScope` and
`formatScopeDistillation`, with `ScopeRecord`, `ScopeDistillation`, `Spill`
and `SpillCause`.

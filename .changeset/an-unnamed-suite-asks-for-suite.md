---
'@variance-authority/cli': patch
---

`variance distill` resolves its suite as `review` does

In a repository that declares several suites, `variance distill` without
`--suite` exits as an operator error that lists the declared suites and asks
for `--suite <name>`, where it failed as a defect in the tool with a stack
trace. With one suite declared, it reads that suite's record.

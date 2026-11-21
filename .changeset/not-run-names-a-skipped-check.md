---
'@variance-authority/playwright-test': minor
'@variance-authority/sense': minor
'@variance-authority/help': minor
'@variance-authority/cli': minor
---

`variance ask not-run` names each check a Playwright test declared and an attempt passed without executing: `expected check <id> did not execute in case <name>`, with the file and line of the case and its project, so a test that passed without its check is told apart from one that checked. A test declares a check with the annotation `variance:check` and runs it as a step of the same title. The reporter records the checks each attempt entered and the scope the run was asked for — projects, `grep`, shard — and a run stopped before Playwright ended it names no check missing.

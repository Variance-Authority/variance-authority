---
'@variance-authority/cli': patch
'@variance-authority/sense': patch
---

`withTestSelection` for Jest, Vitest and Rstest refuses an entry in `preconditions` that cannot be read as a file when the run starts, before any test. The refusal names the path each entry resolved to, and says each entry is the path of one file. A glob, a directory or a missing file used to fail the run in the reporter after its tests passed. A command that runs no test, such as `jest --listTests`, `vitest list`, `rstest list` or `vite build`, is not refused, and neither is a run with no test file or a project `--project` left out. Rstest cannot tell a run with no test file in a page or in a watch session, so it refuses those.

A file only a test writes, absent when the run starts, is refused too, where that run used to pass: write the file before the runner starts. So is a file global setup writes under Vitest and Rstest, which announce the run first; Jest announces it after global setup and still accepts one, and every test declaring that file is recorded incomplete and runs again.

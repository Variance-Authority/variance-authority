---
"@variance-authority/sense": patch
---

A test run that fails before it ends takes its shims off

The setup and case-runner modules the Vitest and Rstest seams write under `.variance-authority/` are now removed when the process exits, if the run's own end did not remove them. Before, a Vitest run that failed before any file ran — a typecheck whose checker could not start is one — exited without calling a reporter or closing its server, and left both files in the project.

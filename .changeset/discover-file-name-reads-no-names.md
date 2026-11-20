---
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`variance ask discover --imports <file>#<name>`, and an `intersection` crossing it, no longer read every file's names when each `imports` and `exceptImports` operand is a name out of a repository file: the source index answers those alone. On a generated 264,000-file monorepo the question took 0.5 s and 1.6 GB peak instead of 7.5 s and 4.9 GB.

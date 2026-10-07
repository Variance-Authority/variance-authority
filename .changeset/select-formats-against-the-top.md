---
'@variance-authority/cli': patch
---

`variance select --format vitest` skips the files it names in a package whose
vitest runs from the package, and under vitest 2. Each skipped file is written
twice: as its path from the directory `select` runs in, which vitest matches in
a project rooted there, and as its absolute path, which vitest 3 and later match
in every project of a workspace. Both are resolved from the top of the
checkout, where the journal's paths start, so `select` names the same files from
any directory inside it. When your vitest config moves `root` or `test.dir`, run
`select` from that directory.

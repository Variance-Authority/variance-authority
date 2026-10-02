---
'@variance-authority/cli': minor
'@variance-authority/core': minor
'@variance-authority/sense': minor
---

`before` moves out of `source` and is declared where the suite is. The top-level
`before` is what every suite rests on — a CI workflow, a `.nvmrc` — and a
suite's own `before`, beside its `kind`, is its runner config and its setup
files, each listed, since a config names its setup as a string and a string is
not an import. `variance select` now reads both for the suite it reads: each
entry is walked down the file graph, and a change to any file it reaches, a
`package.json` whose `exports`, `main` or `type` moved over one of those files,
or a bump of a package those files import, runs the whole suite and names what
moved. A directory in either list is walked from every file under it. `select
--execution` reads the same lists for the suite `--suite` names, the only one
declared, or every declared suite when none is named; beside a snapshot
`--execution`, `--suite` is refused, since both name the record. A manifest move
is read when the diff leaves every lockfile alone. A
config below the repository root inherits the root's `before`, as it inherits
its suites. A suite that declares nothing has nothing before its reach, and
`select` says so.
`variance run --since` reads the top-level list as it read `source.before`.

`source.before` is refused: move it to the top level.

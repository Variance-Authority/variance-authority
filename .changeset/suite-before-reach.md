---
'@variance-authority/cli': minor
'@variance-authority/sense': minor
---

`before` moves out of `source` and is declared where the suite is. The top-level
`before` is what every suite rests on — a CI workflow, a `.nvmrc` — and a
suite's own `before`, beside its `kind`, is its runner config and the setup it
loads. `variance select` now reads both for the suite it reads: each entry is
walked down the file graph, and a change to any file it reaches, or a bump of a
package those files import, runs the whole suite and names what moved. A suite
that declares nothing has nothing before its reach, and `select` says so.
`variance run --since` reads the top-level list as it read `source.before`.

`source.before` is refused: move it to the top level.

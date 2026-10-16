---
'@variance-authority/help': minor
'@variance-authority/mcp': minor
'@variance-authority/cli': minor
---

`variance ask dependents` lists what rests on a file or a name, each with the chain that reaches it

`uses` answers who imports a name, one import away, and `search --to` keeps the
names in the code that reaches a path without saying how it gets there.
`variance ask dependents --file <path>` and `--name <name>` (with `--package` to
narrow the name) answer every file that reaches the subject through imports at
any depth, grouped by how many imports away it is, nearest first, each with one
shortest chain of imports as the evidence. Asked of a name, the walk starts at
the lines that import that name, as `uses` lists them, so a file importing a
different name through the same barrel is not reached. Every import kind is
walked; a type-only, re-export, `import()` or asset step is marked on the chain.
`--limit` bounds the rows printed, 50 when not said, and counts the rest with
how far the farthest is. The answer names the files whose imports the scan
could not resolve, since they may reach the subject unseen. The workspace API
server answers it as `docs_dependents`, and it takes part in intersections as a
set of files.

`@variance-authority/mcp`'s `Tree` has `chainsTo(seeds)`, which returns each
dependent's import distance and one shortest chain, reaching file first, with
the kind of each step, from the same walk `dependentsOf` makes.

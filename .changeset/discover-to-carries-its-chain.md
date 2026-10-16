---
'@variance-authority/help': minor
'@variance-authority/mcp': minor
---

`discover --to` says how each file reaches the path, and takes a name out of a file

A file two or more imports away from a `--to` path now carries one shortest
chain of imports to it, `src/Page.ts → src/Model.ts (type import) →
src/store/selectors.ts`, with each step that is not a plain import marked. The
chain is built only for the files shown.

`--to src/store/selectors.ts#selectBalance` answers what rests on one name: the
walk starts at the files that import `selectBalance`, as `uses` lists them,
through every barrel that passes it on, so a file that imports another name
through the same barrel is not reached. The files that import the name show the
line that does; a file further out has its chain end at that line.

The `--to` header names the files the walk did not reach that import something
the scan could not resolve, since they may reach the path through it. It used
to count the unresolved files among those it reached, which says nothing about
what reaches the path.

`@variance-authority/mcp`'s `Tree` has `chainsTo(seeds)`: each file's import
distance to the seeds, and one shortest chain per file, asked per file.

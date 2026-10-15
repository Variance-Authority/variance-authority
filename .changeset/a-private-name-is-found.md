---
'@variance-authority/sense': minor
'@variance-authority/help': minor
---

`symbol` and `search` find a name a file declares and does not export

The source index harvests every top-level declaration of every file it parses,
and `symbol` and `search` read only the exported ones. A module-private function
such as `relaunch` in `packages/cli/src/bin.ts` was answered by `symbol` with
*the dependency lexicon is not published*, and by `search` with *Nothing in this
repository is named* it, while `git grep` found it at once.

`symbol` now answers such a name, when no entry publishes it and no file exports
it, with one block per declaration: its kind, the file and line that declare it
and the package that owns them, its signature and documentation as the checkout
holds them, and that nothing outside the file can import it. Source comes before
tests and stories, and past five declarations the rest are counted. `search`
lists the declarations whose names hold the query under *N more names are
declared somewhere in the repository without being exported*, after the exported
ones, and within the area when `from` or `to` is given. A declaration its own
file exports, under its name or another, is left to the export lists. A file the
index read without harvesting its declarations is named as not read, rather than
counted as declaring nothing.

`@variance-authority/sense` exports `declaredOf(root, query, { containing, files })`,
which reads these declarations off the published source index.

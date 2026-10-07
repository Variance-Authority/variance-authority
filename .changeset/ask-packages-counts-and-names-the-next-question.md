---
"@variance-authority/help": patch
"@variance-authority/cli": patch
"@variance-authority/package": patch
"@variance-authority/sense": patch
---

`variance ask packages` (`docs_packages`) counts and lists no import site: one
row per published specifier, one per package that declares no entry with how
many of its names and files other packages import by path, and per package the
number of imports that reach past a published entrypoint. It ends with the
`variance ask entrypoint --package <name>` questions that list the sites behind
those counts. `variance ask entrypoint --package <name>` (`docs_entrypoint`)
asked by a package's name now also lists each import that reaches past its
entry, and asked by such a specifier lists that specifier's imports. Asked by
the name of a package whose `exports` opens only subpaths, it lists the
specifiers the package opens where it used to refuse with "does not open `.`".

An import into a published package whose declared entry leads to no source
file, such as a `main` naming a build output the checkout does not hold, is
kept as an import past that entry, where every one was dropped and `variance ask
entrypoint` said no other package imports it. `variance ask packages` counts
those packages, and `uses` and `symbol` answer for the names taken from them.
`readUnentered` is replaced by `readImportTargets`, which reads the published
packages and the ones that declare no entry in one pass.

On a repository whose packages declare no entry, `variance ask packages` went from
200,330 lines in 30 to 45 seconds to 1,327 lines in under half a second.

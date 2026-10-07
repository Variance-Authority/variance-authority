---
"@variance-authority/help": patch
"@variance-authority/cli": patch
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
On a
repository whose packages declare no entry, `variance ask packages` went from
200,330 lines in 30 to 45 seconds to 1,327 lines in under half a second.

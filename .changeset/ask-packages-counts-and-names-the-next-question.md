---
"@variance-authority/help": patch
"@variance-authority/cli": patch
"@variance-authority/package": patch
"@variance-authority/sense": patch
---

`variance ask packages` (`docs_packages`) counts and lists no import site: one
row per published specifier, one per package that declares no entry with how
many of its names and files other packages import by path, under the heading
"N packages that declare no entry are imported by path", and per package the
number of imports that reach past a published entrypoint. It ends with the
`variance ask entrypoint --package <name>` questions behind those counts.

`variance ask entrypoint --package <name>` (`docs_entrypoint`) asked by a
package's name now also counts the imports that reach past its entry, or, for a
package that declares no entry, the imports of its files by path, one row per
file: its specifier, how many names are taken from it and how many files import
it, the most imported first. Asked by one of those specifiers, it lists each
import of that file with the importer's file and line. Under a package that
declares no entry, a specifier's count is of distinct names taken in distinct
files, where every import of a name was counted again: fifty files importing
one name read "50 names" and now read "1 name". Asked by the name of a package
whose `exports` opens only subpaths, it lists the specifiers the package opens
where it used to refuse with "does not open `.`". `--subpath .` answers exactly
as the package name alone, where it left out the imports past the entry, or
refused for a package that opens only subpaths.

An import into a published package whose declared entry leads to no source
file, such as a `main` naming a build output the checkout does not hold, is
kept as an import past that entry, where every one was dropped and `variance ask
entrypoint` said no other package imports it. `variance ask packages` counts
those packages, and `uses` and `symbol` answer for the names taken from them.
`readUnentered` is replaced by `readImportTargets`, which reads the published
packages and the ones that declare no entry in one pass, and `landing` says
where one import between packages lands: opened by an entry, past a declared
entry, by path into a package that declares none, or not followed.

On a repository whose packages declare no entry, `variance ask packages` went from
200,330 lines in 30 to 45 seconds to 1,327 lines in under half a second.
